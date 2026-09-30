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
  // Find sender and receiver accounts
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

  // Pick sender and receiver from different users
  const senderRow = accountsRes.rows[0];
  const receiverRow = accountsRes.rows.find((r) => r.user_id !== senderRow.user_id) || accountsRes.rows[1];

  senderUserId = senderRow.user_id;
  senderAccountId = senderRow.account_id;
  receiverAccountId = receiverRow.account_id;

  // Set sender initial balance to 1000 for predictable testing
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [senderAccountId]);

  // Generate JWT token for sender
  token = jwt.sign(
    { id: senderUserId, name: senderRow.name, email: senderRow.email },
    process.env.JWT_Access_SECRET || 'finflow_access_secret_key_2026',
    { expiresIn: '1h' }
  );

  // Start HTTP server on dynamic port
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

test('1. Missing Idempotency-Key header is rejected with 400 Bad Request', async () => {
  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receiverAccountId,
      amount: 50.0,
      description: 'Transfer without key',
    }),
  });

  const body = await res.json();
  assert.equal(res.status, 400);
  assert.match(body.message, /Idempotency-Key header is required/i);
});

test('2. First request with a unique key succeeds and debits account', async () => {
  const key = `test-key-${Date.now()}-1`;

  const balanceBeforeRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  const balanceBefore = parseFloat(balanceBeforeRes.rows[0].balance);

  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 100.0,
      description: 'First idempotent transfer',
    }),
  });

  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.sender.newBalance, balanceBefore - 100.0);

  // Verify balance in DB
  const balanceAfterRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  const balanceAfter = parseFloat(balanceAfterRes.rows[0].balance);
  assert.equal(balanceAfter, balanceBefore - 100.0);
});

test('3. Duplicate request with the exact same key replays cached response without moving funds again', async () => {
  const key = `test-key-${Date.now()}-2`;

  // First request
  const res1 = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 50.0,
      description: 'Testing duplicate key replay',
    }),
  });
  const body1 = await res1.json();
  assert.equal(res1.status, 200);

  // Record balance after first request
  const balanceAfterFirstRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  const balanceAfterFirst = parseFloat(balanceAfterFirstRes.rows[0].balance);

  // Second request with SAME key and SAME body
  const res2 = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 50.0,
      description: 'Testing duplicate key replay',
    }),
  });
  const body2 = await res2.json();

  // Verification:
  // Must return 200
  assert.equal(res2.status, 200);
  // Must include replay header
  assert.equal(res2.headers.get('idempotency-replayed'), 'true');
  // Must match original transaction ID
  assert.equal(body2.data.transaction.id, body1.data.transaction.id);

  // CRITICAL: Sender balance MUST NOT be debited again
  const balanceAfterSecondRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  const balanceAfterSecond = parseFloat(balanceAfterSecondRes.rows[0].balance);
  assert.equal(balanceAfterSecond, balanceAfterFirst);
});

test('4. Same idempotency key with different request payload is rejected with 400', async () => {
  const key = `test-key-${Date.now()}-3`;

  // First request
  const res1 = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 40.0,
      description: 'Original payload',
    }),
  });
  assert.equal(res1.status, 200);

  // Second request with SAME key but DIFFERENT amount (75.0 instead of 40.0)
  const res2 = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 75.0,
      description: 'Tampered or mismatched payload',
    }),
  });

  const body2 = await res2.json();
  assert.equal(res2.status, 400);
  assert.match(body2.message, /Idempotency key reuse: request payload does not match/i);
});

test('5. Failed transfer rolls back, and retrying with sufficient funds succeeds', async () => {
  const key = `test-key-${Date.now()}-4`;

  // Attempt transfer with amount higher than available balance (e.g. ₹999,999)
  const res1 = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 999999.0,
      description: 'Overdraft transfer',
    }),
  });

  const body1 = await res1.json();
  assert.equal(res1.status, 400);
  assert.match(body1.message, /Insufficient balance/i);

  // Ensure balance was NOT changed
  const balanceAfterFailRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  const balanceAfterFail = parseFloat(balanceAfterFailRes.rows[0].balance);

  // Top up sender balance to 1,000,000 to allow successful retry
  await pool.query('UPDATE accounts SET balance = 1500000.00 WHERE id = $1', [senderAccountId]);

  // Retry the transfer with the SAME key and SAME payload now that funds are available
  const res2 = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 999999.0,
      description: 'Overdraft transfer',
    }),
  });

  const body2 = await res2.json();
  assert.equal(res2.status, 200);
  assert.equal(body2.success, true);
  assert.equal(body2.data.sender.newBalance, 1500000.0 - 999999.0);
});
