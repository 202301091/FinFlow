import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db.js';
import { getTransactionHistory } from '../src/services/transaction.service.js';

describe('Day-6 Step 7: Keyset Cursor Pagination & Scalability', () => {
  let userId;
  let accountA;
  let accountB;
  const createdTransactionIds = [];

  before(async () => {
    // 1. Create a test user
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ('Cursor Test User', 'cursor_test_${Date.now()}@finflow.test', 'hashed_pw')
       RETURNING id`
    );
    userId = userRes.rows[0].id;

    // 2. Create two test accounts
    const acc1Res = await pool.query(
      `INSERT INTO accounts (user_id, account_type, balance, currency)
       VALUES ($1, 'checking', 10000.00, 'INR')
       RETURNING id`,
      [userId]
    );
    accountA = acc1Res.rows[0].id;

    const acc2Res = await pool.query(
      `INSERT INTO accounts (user_id, account_type, balance, currency)
       VALUES ($1, 'savings', 10000.00, 'INR')
       RETURNING id`,
      [userId]
    );
    accountB = acc2Res.rows[0].id;

    // 3. Insert 5 consecutive transactions with slight delay to ensure sequential created_at
    for (let i = 1; i <= 5; i++) {
      const txRes = await pool.query(
        `INSERT INTO transactions (
           sender_account_id, receiver_account_id, amount, currency, status, description, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'INR', 'completed', $4, NOW() + INTERVAL '${i} millisecond', NOW())
         RETURNING id`,
        [accountA, accountB, i * 10, `Cursor batch transfer ${i}`]
      );
      createdTransactionIds.push(txRes.rows[0].id);
    }
  });

  after(async () => {
    // Cleanup created test records
    if (createdTransactionIds.length > 0) {
      await pool.query(`DELETE FROM transactions WHERE id = ANY($1)`, [createdTransactionIds]);
    }
    if (accountA && accountB) {
      await pool.query(`DELETE FROM accounts WHERE id IN ($1, $2)`, [accountA, accountB]);
    }
    if (userId) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
    await pool.end();
  });

  test('Cursor pagination: retrieves records page-by-page deterministically without duplicates', async () => {
    // Page 1: fetch 2 items with cursor mode
    const page1 = await getTransactionHistory({
      userId,
      limit: 2,
      cursor: 'START', // non-empty cursor triggers cursor mode
    });

    assert.equal(page1.pagination.type, 'cursor');
    assert.equal(page1.transactions.length, 2);
    assert.equal(page1.pagination.hasMore, true);
    assert.ok(page1.pagination.nextCursor, 'nextCursor must be returned for subsequent page');

    // Page 2: fetch next 2 items using nextCursor
    const page2 = await getTransactionHistory({
      userId,
      limit: 2,
      cursor: page1.pagination.nextCursor,
    });

    assert.equal(page2.transactions.length, 2);
    assert.equal(page2.pagination.hasMore, true);
    assert.ok(page2.pagination.nextCursor);

    // Verify Page 1 and Page 2 have no overlapping transactions
    const page1Ids = page1.transactions.map((t) => t.id);
    const page2Ids = page2.transactions.map((t) => t.id);
    for (const id of page2Ids) {
      assert.ok(!page1Ids.includes(id), `Page 2 item ${id} should not appear in Page 1`);
    }

    // Page 3: fetch remaining item
    const page3 = await getTransactionHistory({
      userId,
      limit: 2,
      cursor: page2.pagination.nextCursor,
    });

    assert.equal(page3.transactions.length, 1);
    assert.equal(page3.pagination.hasMore, false);
    assert.equal(page3.pagination.nextCursor, null, 'nextCursor should be null when on last page');

    // Total unique items fetched across all 3 pages must equal 5
    const allFetched = [...page1Ids, ...page2Ids, ...page3.transactions.map((t) => t.id)];
    assert.equal(allFetched.length, 5);
  });

  test('Backward compatibility: traditional offset pagination continues working when cursor is omitted', async () => {
    const offsetResult = await getTransactionHistory({
      userId,
      page: 1,
      limit: 3,
    });

    assert.equal(offsetResult.pagination.type, 'offset');
    assert.equal(offsetResult.pagination.page, 1);
    assert.equal(offsetResult.pagination.limit, 3);
    assert.equal(offsetResult.pagination.total, 5);
    assert.equal(offsetResult.pagination.totalPages, 2);
    assert.equal(offsetResult.transactions.length, 3);
  });
});
