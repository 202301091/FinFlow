import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';

let server;
let baseUrl;
let token;
let senderUserId;
let senderAccountId;
let receiverAccountId;

before(async () => {
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

  const senderRow = accountsRes.rows[0];
  const receiverRow = accountsRes.rows.find((r) => r.user_id !== senderRow.user_id) || accountsRes.rows[1];

  senderUserId = senderRow.user_id;
  senderAccountId = senderRow.account_id;
  receiverAccountId = receiverRow.account_id;

  token = jwt.sign(
    { id: senderUserId, name: senderRow.name, email: senderRow.email },
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

test('Rollback: Failed transfer due to overdraft completely rolls back balances and creates no ledger row', async () => {
  // Set known initial balances
  await pool.query('UPDATE accounts SET balance = 500.00 WHERE id = $1', [senderAccountId]);
  await pool.query('UPDATE accounts SET balance = 500.00 WHERE id = $1', [receiverAccountId]);

  const countBeforeRes = await pool.query('SELECT COUNT(*) FROM transactions');
  const countBefore = parseInt(countBeforeRes.rows[0].count, 10);

  const idempotencyKey = `rollback-overdraft-${Date.now()}`;

  // Attempt to transfer ₹800 when sender only has ₹500
  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 800.0,
      description: 'Rollback test: overdraft',
    }),
  });

  assert.equal(res.status, 400);

  // Verify Sender balance was NOT debited
  const senderRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  assert.equal(parseFloat(senderRes.rows[0].balance), 500.0, 'Sender balance must remain unchanged at 500.00');

  // Verify Receiver balance was NOT credited
  const receiverRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [receiverAccountId]);
  assert.equal(parseFloat(receiverRes.rows[0].balance), 500.0, 'Receiver balance must remain unchanged at 500.00');

  // Verify no new transaction row was inserted in ledger
  const countAfterRes = await pool.query('SELECT COUNT(*) FROM transactions');
  const countAfter = parseInt(countAfterRes.rows[0].count, 10);
  assert.equal(countAfter, countBefore, 'Transactions table row count must not increase on rollback');
});

test('Rollback: Non-existent receiver rolls back and leaves sender balance intact', async () => {
  await pool.query('UPDATE accounts SET balance = 750.00 WHERE id = $1', [senderAccountId]);
  const fakeReceiverId = 'b0000000-0000-4000-8000-000000000000';

  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `rollback-fake-rcv-${Date.now()}`,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId: fakeReceiverId,
      amount: 100.0,
      description: 'Rollback test: fake receiver',
    }),
  });

  assert.equal(res.status, 404);

  const senderRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  assert.equal(parseFloat(senderRes.rows[0].balance), 750.0, 'Sender balance must remain exactly 750.00');
});

test('Rollback: Same sender and receiver rejection preserves database state', async () => {
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [senderAccountId]);

  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `rollback-same-acc-${Date.now()}`,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId: senderAccountId, // Sending to self is rejected
      amount: 50.0,
    }),
  });

  assert.equal(res.status, 400);

  const senderRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  assert.equal(parseFloat(senderRes.rows[0].balance), 1000.0);
});
