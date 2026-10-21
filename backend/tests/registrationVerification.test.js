import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
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
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test('Registration Email Verification Suite: End-to-End OTP Ownership Flow', async (t) => {
  const timestamp = Date.now();
  const testEmail = `reg_verify_${timestamp}@example.com`;
  const testName = 'Verified User';
  const testPassword = 'StrongPassword999!';
  let generatedOtp = null;

  // 1. Request registration OTP with missing fields -> 400
  await t.test('1. Request OTP with missing name or password fails with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/send-registration-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, name: '' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
  });

  // 2. Request registration OTP with valid details -> 200 and OTP generated
  await t.test('2. Request OTP with valid details generates 6-digit OTP and sends email', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/send-registration-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.devOtp, 'devOtp must be returned in test mode');
    assert.match(body.data.devOtp, /^\d{6}$/, 'OTP must be 6 digits');
    generatedOtp = body.data.devOtp;

    // Verify OTP exists in PostgreSQL email_verifications table
    const dbRecord = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND type = \'REGISTRATION\' AND used = false ORDER BY created_at DESC LIMIT 1',
      [testEmail]
    );
    assert.equal(dbRecord.rows.length, 1);
    assert.equal(dbRecord.rows[0].otp, generatedOtp);
  });

  // 3. Complete registration with wrong OTP -> 400
  await t.test('3. Complete registration with wrong OTP fails with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testName,
        email: testEmail,
        password: testPassword,
        otp: '000000',
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.message, /Invalid or expired email verification code/i);
  });

  // 4. Complete registration with correct OTP -> 201
  await t.test('4. Complete registration with valid OTP succeeds with 201', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testName,
        email: testEmail,
        password: testPassword,
        otp: generatedOtp,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.data.email, testEmail);
    assert.equal(body.data.name, testName);
    assert.equal(body.data.is_email_verified, true);
  });

  // 5. Attempt to register again with same email -> 409
  await t.test('5. Attempt to register existing email fails with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/send-registration-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
    });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.match(body.message, /already exists/i);
  });

  // 6. Attempt replay of used OTP -> 400
  await t.test('6. Attempt replay with used OTP fails', async () => {
    const anotherEmail = `another_${timestamp}@example.com`;
    const res = await fetch(`${baseUrl}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Another User',
        email: anotherEmail,
        password: testPassword,
        otp: generatedOtp,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
  });

  // 7. Login with newly verified user -> 200
  await t.test('7. Login with newly registered user succeeds with 200', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.tokens.accessToken);
  });
});
