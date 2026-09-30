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

test('Concurrent transfers: Two simultaneous ₹800 transfers on ₹1000 balance allow only one to succeed', async () => {
  // 1. Reset sender balance to 1000.00
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [senderAccountId]);
  const initialReceiverRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [receiverAccountId]);
  const initialReceiverBalance = parseFloat(initialReceiverRes.rows[0].balance);

  // 2. Prepare two distinct requests with different idempotency keys
  const keyA = `concurrent-a-${Date.now()}`;
  const keyB = `concurrent-b-${Date.now()}`;

  const sendTransfer = (key, memo) =>
    fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        senderAccountId,
        receiverAccountId,
        amount: 800.0,
        description: memo,
      }),
    }).then(async (res) => ({
      status: res.status,
      body: await res.json(),
    }));

  // 3. Fire both requests simultaneously using Promise.all
  const [resultA, resultB] = await Promise.all([
    sendTransfer(keyA, 'Concurrent Transfer A'),
    sendTransfer(keyB, 'Concurrent Transfer B'),
  ]);

  const results = [resultA, resultB];
  const successful = results.filter((r) => r.status === 200);
  const failed = results.filter((r) => r.status === 400);

  // 4. Assertions: Exactly one succeeded and one failed
  assert.equal(successful.length, 1, 'Exactly one concurrent transfer must succeed');
  assert.equal(failed.length, 1, 'Exactly one concurrent transfer must fail');
  assert.match(failed[0].body.message, /Insufficient balance/i);

  // 5. Verify database balance integrity
  const finalSenderRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  const finalSenderBalance = parseFloat(finalSenderRes.rows[0].balance);
  assert.equal(finalSenderBalance, 200.0, 'Final sender balance must be exactly ₹200.00');

  const finalReceiverRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [receiverAccountId]);
  const finalReceiverBalance = parseFloat(finalReceiverRes.rows[0].balance);
  assert.equal(
    finalReceiverBalance,
    initialReceiverBalance + 800.0,
    'Receiver balance must increase by exactly ₹800.00'
  );
});

test('Concurrent transfers: 5 simultaneous ₹300 transfers on ₹1000 balance allow exactly 3 to succeed', async () => {
  // 1. Reset sender balance to 1000.00
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [senderAccountId]);

  // 2. Prepare 5 concurrent transfers of ₹300 (total ₹1500 > ₹1000)
  const promises = Array.from({ length: 5 }, (_, i) => {
    const key = `concurrent-stress-${Date.now()}-${i}`;
    return fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        senderAccountId,
        receiverAccountId,
        amount: 300.0,
        description: `Stress transfer #${i + 1}`,
      }),
    }).then(async (res) => ({
      status: res.status,
      body: await res.json(),
    }));
  });

  const results = await Promise.all(promises);
  const successful = results.filter((r) => r.status === 200);
  const failed = results.filter((r) => r.status === 400);

  // 3. Exactly 3 must succeed (3 * 300 = 900), 2 must fail (1000 - 900 = 100 remaining, < 300)
  assert.equal(successful.length, 3, 'Exactly 3 transfers must succeed');
  assert.equal(failed.length, 2, 'Exactly 2 transfers must fail');

  // 4. Final sender balance must be exactly ₹100.00
  const finalSenderRes = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
  const finalSenderBalance = parseFloat(finalSenderRes.rows[0].balance);
  assert.equal(finalSenderBalance, 100.0, 'Final sender balance must be exactly ₹100.00');
});
