import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Ensure database schema has transaction_pin_hash
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT;`);
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Transaction Security PIN Suite: 6-Digit PIN Lifecycle & Transfer Enforcement', async (t) => {
  const timestamp = Date.now();
  const user1Email = `pin_sender_${timestamp}@test.com`;
  const user2Email = `pin_receiver_${timestamp}@test.com`;
  const defaultPassword = 'SecurePassword123!';
  const valid6DigitPin = '849201';
  const wrong6DigitPin = '112233';

  let user1Token;
  let user1Id;
  let user1AccountId;
  let user2AccountId;

  // 1. Setup User 1 (Sender) and User 2 (Receiver)
  await t.test('1. Register users and set up initial accounts with balance', async () => {
    // Register User 1
    const regRes1 = await fetch(`${baseUrl}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sender User', email: user1Email, password: defaultPassword }),
    });
    const regBody1 = await regRes1.json();
    assert.equal(regRes1.status, 201);
    user1Id = regBody1.data.id;

    // Login User 1
    const loginRes1 = await fetch(`${baseUrl}/api/v1/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: defaultPassword }),
    });
    const loginBody1 = await loginRes1.json();
    assert.equal(loginRes1.status, 200);
    user1Token = loginBody1.data.tokens.accessToken;
    assert.equal(loginBody1.data.user.hasPin, false, 'Initial user should have hasPin: false');

    // Create Account for User 1
    const accRes1 = await fetch(`${baseUrl}/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ account_type: 'savings', balance: 5000 }),
    });
    const accBody1 = await accRes1.json();
    assert.equal(accRes1.status, 201);
    user1AccountId = accBody1.data.id;

    // Register User 2 & create account
    const regRes2 = await fetch(`${baseUrl}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Receiver User', email: user2Email, password: defaultPassword }),
    });
    const regBody2 = await regRes2.json();
    assert.equal(regRes2.status, 201);

    const loginRes2 = await fetch(`${baseUrl}/api/v1/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user2Email, password: defaultPassword }),
    });
    const loginBody2 = await loginRes2.json();
    const user2Token = loginBody2.data.tokens.accessToken;

    const accRes2 = await fetch(`${baseUrl}/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2Token}`,
      },
      body: JSON.stringify({ account_type: 'savings', balance: 100 }),
    });
    const accBody2 = await accRes2.json();
    assert.equal(accRes2.status, 201);
    user2AccountId = accBody2.data.id;
  });

  // 2. Initial PIN status is false
  await t.test('2. GET /api/v1/users/pin-status reports hasPin: false initially', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/pin-status`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.hasPin, false);
  });

  // 3. Validation on set-pin (invalid PIN formats & wrong password)
  await t.test('3. POST /api/v1/users/set-pin enforces 6 numeric digits and password authorization', async () => {
    // A. 4-digit PIN should be rejected (must be 6 digits)
    const resShort = await fetch(`${baseUrl}/api/v1/users/set-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ pin: '1234', password: defaultPassword }),
    });
    assert.equal(resShort.status, 400);

    // B. Alphabetic/non-numeric PIN should be rejected
    const resAlpha = await fetch(`${baseUrl}/api/v1/users/set-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ pin: '12AB56', password: defaultPassword }),
    });
    assert.equal(resAlpha.status, 400);

    // C. Wrong password should be rejected with 401
    const resWrongPass = await fetch(`${baseUrl}/api/v1/users/set-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ pin: valid6DigitPin, password: 'WrongPassword999' }),
    });
    assert.equal(resWrongPass.status, 401);
  });

  // 4. Successfully configure 6-digit transaction PIN
  await t.test('4. POST /api/v1/users/set-pin successfully sets 6-digit transaction PIN', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/set-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ pin: valid6DigitPin, password: defaultPassword }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.hasPin, true);

    // Verify GET /pin-status now reports true
    const statusRes = await fetch(`${baseUrl}/api/v1/users/pin-status`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    const statusBody = await statusRes.json();
    assert.equal(statusBody.data.hasPin, true);
  });

  // 5. Transfer rejected when PIN is missing
  await t.test('5. POST /api/v1/transactions/transfer fails with 400 if 6-digit PIN is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
        'Idempotency-Key': `idem-missing-pin-${Date.now()}`,
      },
      body: JSON.stringify({
        senderAccountId: user1AccountId,
        receiverAccountId: user2AccountId,
        amount: 250,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.message, /6-digit Transaction PIN is required/i);
  });

  // 6. Transfer rejected when PIN is wrong
  await t.test('6. POST /api/v1/transactions/transfer fails with 401 if incorrect PIN is provided', async () => {
    const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
        'Idempotency-Key': `idem-wrong-pin-${Date.now()}`,
      },
      body: JSON.stringify({
        senderAccountId: user1AccountId,
        receiverAccountId: user2AccountId,
        amount: 250,
        transactionPin: wrong6DigitPin,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.match(body.message, /Invalid transaction PIN/i);
  });

  // 7. Transfer succeeds when correct 6-digit PIN is provided
  await t.test('7. POST /api/v1/transactions/transfer succeeds with valid 6-digit PIN', async () => {
    const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
        'Idempotency-Key': `idem-valid-pin-${Date.now()}`,
      },
      body: JSON.stringify({
        senderAccountId: user1AccountId,
        receiverAccountId: user2AccountId,
        amount: 500,
        description: 'Authorized via 6-digit PIN',
        transactionPin: valid6DigitPin,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.statusCode, 200);
    assert.equal(body.data.sender.newBalance, 4500);
    assert.equal(body.data.receiver.newBalance, 600);
  });
});
