import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db.js';
import { connectRedis, disconnectRedis, redisClient } from '../src/config/redis.js';
import { getAccounts, createAccount } from '../src/controllers/account.controllers.js';
import { transferFunds } from '../src/services/transaction.service.js';

test('Redis Failure Handling & Resilience Suite', async (t) => {
  let testUserId;
  let testAccountA;
  let testAccountB;

  t.before(async () => {
    // 1. Create a clean test user and two test accounts
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`Resilience User ${Date.now()}`, `resilience_${Date.now()}@example.com`, 'hash123']
    );
    testUserId = userRes.rows[0].id;

    const accARes = await pool.query(
      `INSERT INTO accounts (user_id, account_type, balance)
       VALUES ($1, 'savings', 500.00)
       RETURNING id`,
      [testUserId]
    );
    testAccountA = accARes.rows[0].id;

    const userBRes = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`Resilience Receiver ${Date.now()}`, `resilience_rcv_${Date.now()}@example.com`, 'hash123']
    );
    const receiverUserId = userBRes.rows[0].id;

    const accBRes = await pool.query(
      `INSERT INTO accounts (user_id, account_type, balance)
       VALUES ($1, 'checking', 200.00)
       RETURNING id`,
      [receiverUserId]
    );
    testAccountB = accBRes.rows[0].id;

    // Disconnect Redis to simulate total Redis outage
    await disconnectRedis();
  });

  t.after(async () => {
    // Clean up test records
    if (testAccountA && testAccountB) {
      await pool.query('DELETE FROM transactions WHERE sender_account_id = $1 OR receiver_account_id = $2', [testAccountA, testAccountB]);
      await pool.query('DELETE FROM accounts WHERE id IN ($1, $2)', [testAccountA, testAccountB]);
    }
    if (testUserId) {
      await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    await disconnectRedis();
    await pool.end();
  });

  await t.test('1. getAccounts gracefully falls back to PostgreSQL when Redis is down', async () => {
    // Ensure Redis client is closed
    assert.equal(redisClient.isOpen, false, 'Redis should be closed for resilience test');

    const req = {
      user: { id: testUserId },
      query: { account_type: 'savings' },
    };

    let responseStatus = 0;
    let responseBody = null;

    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(payload) {
        responseBody = payload;
        return this;
      },
    };

    await getAccounts(req, res);

    assert.equal(responseStatus, 200, 'Must return 200 OK even when Redis is offline');
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.message, 'Accounts fetched successfully');
    assert.equal(responseBody.data.length, 1);
    assert.equal(responseBody.data[0].id, testAccountA);
    assert.equal(parseFloat(responseBody.data[0].balance), 500.0);
  });

  await t.test('2. createAccount succeeds and commits to PostgreSQL when Redis is down', async () => {
    const req = {
      user: { id: testUserId },
      body: {
        account_type: 'checking',
        balance: 350.00,
      },
      id: 'resilience-req-1',
    };

    let responseStatus = 0;
    let responseBody = null;

    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(payload) {
        responseBody = payload;
        return this;
      },
    };

    await createAccount(req, res);

    assert.equal(responseStatus, 201, 'Must return 201 Created even when Redis cache invalidation fails');
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.data.account_type, 'checking');
    assert.equal(parseFloat(responseBody.data.balance), 350.00);

    // Verify persisted in PostgreSQL
    const checkDb = await pool.query('SELECT * FROM accounts WHERE id = $1', [responseBody.data.id]);
    assert.equal(checkDb.rows.length, 1);
  });

  await t.test('3. transferFunds succeeds and commits transaction when Redis is down', async () => {
    const transferResult = await transferFunds({
      userId: testUserId,
      senderAccountId: testAccountA,
      receiverAccountId: testAccountB,
      amount: 150.00,
      description: 'Transfer during Redis outage',
    });

    assert.ok(transferResult.transaction, 'Transaction record must exist');
    assert.equal(transferResult.sender.newBalance, 350.00);
    assert.equal(transferResult.receiver.newBalance, 350.00);

    // Verify balance in authoritative PostgreSQL database
    const senderDb = await pool.query('SELECT balance FROM accounts WHERE id = $1', [testAccountA]);
    const receiverDb = await pool.query('SELECT balance FROM accounts WHERE id = $1', [testAccountB]);

    assert.equal(parseFloat(senderDb.rows[0].balance), 350.00);
    assert.equal(parseFloat(receiverDb.rows[0].balance), 350.00);
  });
});
