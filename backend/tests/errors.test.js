import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';

let server;
let baseUrl;
let token;
let userA;
let accountA;

before(async () => {
  const accountsRes = await pool.query(`
    SELECT a.id as account_id, a.user_id, a.balance, u.name, u.email
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    WHERE a.status = 'active'
    ORDER BY a.created_at ASC
  `);

  const row = accountsRes.rows[0];
  userA = row.user_id;
  accountA = row.account_id;

  token = jwt.sign(
    { id: userA, name: row.name, email: row.email },
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

test('Error Handling: Unauthorized (401) on missing token', async () => {
  const res = await fetch(`${baseUrl}/api/v1/transactions`);
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.equal(body.success, false);
  assert.match(body.message, /Access token is missing/i);
});

test('Error Handling: Forbidden (403) on invalid JWT token', async () => {
  const res = await fetch(`${baseUrl}/api/v1/transactions`, {
    headers: {
      Authorization: 'Bearer invalid.token.payload',
    },
  });
  const body = await res.json();

  assert.equal(res.status, 403);
  assert.equal(body.success, false);
});

test('Error Handling: Bad Input (400) on malformed amount', async () => {
  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `err-test-${Date.now()}`,
    },
    body: JSON.stringify({
      receiverAccountId: accountA,
      amount: -50.0, // Invalid negative amount
    }),
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /positive number/i);
});

test('Error Handling: Not Found (404) for non-existent transaction', async () => {
  const nonExistentUuid = 'a0000000-0000-4000-8000-000000000000';
  const res = await fetch(`${baseUrl}/api/v1/transactions/${nonExistentUuid}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.equal(body.success, false);
  assert.match(body.message, /not found/i);
});

test('Error Handling: Database error shielding (400) on invalid UUID format', async () => {
  // Pass invalid non-UUID string to an endpoint expecting UUID
  const res = await fetch(`${baseUrl}/api/v1/transactions/not-a-valid-uuid`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  // Ensure internal SQL table/column names are NOT leaked
  assert.doesNotMatch(body.message, /SELECT|FROM|WHERE|transactions/i);
});

test('Error Handling: Uniform error JSON structure is maintained', async () => {
  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const body = await res.json();

  assert.ok('statusCode' in body);
  assert.ok('data' in body);
  assert.ok('message' in body);
  assert.equal(body.success, false);
  assert.ok('errors' in body);
});
