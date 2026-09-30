import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';

let server;
let baseUrl;
let tokenA;
let tokenB;
let userA;
let userB;
let accountA;
let accountB;

before(async () => {
  // Query two different users with active accounts
  const accountsRes = await pool.query(`
    SELECT a.id as account_id, a.user_id, a.balance, u.name, u.email
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    WHERE a.status = 'active'
    ORDER BY a.created_at ASC
  `);

  if (accountsRes.rows.length < 2) {
    throw new Error('Test requires at least 2 active accounts in database');
  }

  const rowA = accountsRes.rows[0];
  const rowB = accountsRes.rows.find((r) => r.user_id !== rowA.user_id) || accountsRes.rows[1];

  userA = rowA.user_id;
  accountA = rowA.account_id;
  userB = rowB.user_id;
  accountB = rowB.account_id;

  // Reset balances to 1000.00 each
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [accountA]);
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [accountB]);

  // JWT for User A
  tokenA = jwt.sign(
    { id: userA, name: rowA.name, email: rowA.email },
    process.env.JWT_Access_SECRET || 'finflow_access_secret_key_2026',
    { expiresIn: '1h' }
  );

  // JWT for User B
  tokenB = jwt.sign(
    { id: userB, name: rowB.name, email: rowB.email },
    process.env.JWT_Access_SECRET || 'finflow_access_secret_key_2026',
    { expiresIn: '1h' }
  );

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test('Deadlock-free cross transfers: Simultaneous A -> B and B -> A complete without deadlock', async () => {
  // Reset initial balances
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [accountA]);
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [accountB]);

  const key1 = `cross-ab-${Date.now()}`;
  const key2 = `cross-ba-${Date.now()}`;

  // Transfer 1: User A sends ₹100 to Account B
  const transferAB = fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
      'Idempotency-Key': key1,
    },
    body: JSON.stringify({
      senderAccountId: accountA,
      receiverAccountId: accountB,
      amount: 100.0,
      description: 'Transfer A to B',
    }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));

  // Transfer 2: User B sends ₹150 to Account A
  const transferBA = fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
      'Idempotency-Key': key2,
    },
    body: JSON.stringify({
      senderAccountId: accountB,
      receiverAccountId: accountA,
      amount: 150.0,
      description: 'Transfer B to A',
    }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));

  // Fire both concurrently
  const [res1, res2] = await Promise.all([transferAB, transferBA]);

  // Both should succeed (HTTP 200) without deadlock
  assert.equal(res1.status, 200, `Transfer A->B failed: ${JSON.stringify(res1.body)}`);
  assert.equal(res2.status, 200, `Transfer B->A failed: ${JSON.stringify(res2.body)}`);

  // Verify financial conservation in DB:
  // Account A: 1000 - 100 + 150 = 1050
  // Account B: 1000 - 150 + 100 = 950
  const finalARes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [accountA]);
  const finalBRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [accountB]);

  const balanceA = parseFloat(finalARes.rows[0].balance);
  const balanceB = parseFloat(finalBRes.rows[0].balance);

  assert.equal(balanceA, 1050.0, 'Account A balance must be exactly 1050.00');
  assert.equal(balanceB, 950.0, 'Account B balance must be exactly 950.00');
  assert.equal(balanceA + balanceB, 2000.0, 'Total money in system must be preserved at 2000.00');
});

test('High-stress concurrent cross transfers: 6 simultaneous bi-directional transfers without deadlock', async () => {
  await pool.query('UPDATE accounts SET balance = 2000.00 WHERE id = $1', [accountA]);
  await pool.query('UPDATE accounts SET balance = 2000.00 WHERE id = $1', [accountB]);

  // 3 transfers A -> B of ₹50 each (= ₹150)
  // 3 transfers B -> A of ₹50 each (= ₹150)
  const operations = [];

  for (let i = 0; i < 3; i++) {
    operations.push(
      fetch(`${baseUrl}/api/v1/transactions/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
          'Idempotency-Key': `stress-ab-${Date.now()}-${i}`,
        },
        body: JSON.stringify({
          senderAccountId: accountA,
          receiverAccountId: accountB,
          amount: 50.0,
          description: `Stress A->B #${i}`,
        }),
      }).then(async (r) => ({ dir: 'A->B', status: r.status, body: await r.json() }))
    );

    operations.push(
      fetch(`${baseUrl}/api/v1/transactions/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenB}`,
          'Idempotency-Key': `stress-ba-${Date.now()}-${i}`,
        },
        body: JSON.stringify({
          senderAccountId: accountB,
          receiverAccountId: accountA,
          amount: 50.0,
          description: `Stress B->A #${i}`,
        }),
      }).then(async (r) => ({ dir: 'B->A', status: r.status, body: await r.json() }))
    );
  }

  const results = await Promise.all(operations);

  // Assert every single transfer succeeded
  for (const r of results) {
    assert.equal(r.status, 200, `Transfer ${r.dir} failed: ${JSON.stringify(r.body)}`);
  }

  // Final balances should still be 2000.00 each
  const finalARes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [accountA]);
  const finalBRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [accountB]);

  assert.equal(parseFloat(finalARes.rows[0].balance), 2000.0);
  assert.equal(parseFloat(finalBRes.rows[0].balance), 2000.0);
});
