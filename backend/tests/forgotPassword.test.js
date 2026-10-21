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

test('Password Reset Suite: End-to-End Forgot Password & OTP Flow', async (t) => {
  const timestamp = Date.now();
  const testEmail = `forgot_pwd_user_${timestamp}@example.com`;
  const initialPassword = 'InitialPass123!';
  const newPassword = 'NewSecretPass999#';
  let generatedOtp = null;

  // 1. Register test user
  await t.test('1. Register test user', async () => {
    const regRes = await fetch(`${baseUrl}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Forgot User', email: testEmail, password: initialPassword }),
    });
    const regBody = await regRes.json();
    assert.equal(regRes.status, 201);
    assert.equal(regBody.data.email, testEmail);
  });

  // 2. Request OTP for non-existent email -> 404
  await t.test('2. Request OTP for non-existent email returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent_account@example.com' }),
    });
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.match(body.message, /No account found/i);
  });

  // 3. Request OTP with missing/invalid email -> 400
  await t.test('3. Request OTP with missing email returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '   ' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
  });

  // 4. Request OTP for valid user -> 200 and OTP generated
  await t.test('4. Request OTP for valid user generates 6-digit OTP', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.devOtp, 'devOtp should be present in development response');
    assert.match(body.data.devOtp, /^\d{6}$/, 'OTP must be 6 digits');
    generatedOtp = body.data.devOtp;

    // Verify OTP exists in PostgreSQL email_verifications table
    const dbRecord = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND type = \'PASSWORD_RESET\' AND used = false ORDER BY created_at DESC LIMIT 1',
      [testEmail]
    );
    assert.equal(dbRecord.rows.length, 1);
    assert.equal(dbRecord.rows[0].otp, generatedOtp);
  });

  // 5. Verify OTP with wrong code -> 400
  await t.test('5. Verify OTP with incorrect code fails with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/verify-reset-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: '000000' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.message, /Invalid or expired OTP/i);
  });

  // 6. Verify OTP with correct code -> 200
  await t.test('6. Verify OTP with valid code succeeds with 200', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/verify-reset-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: generatedOtp }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.verified, true);
  });

  // 7. Reset password with invalid password format -> 400
  await t.test('7. Reset password with weak password fails validation with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: generatedOtp, newPassword: 'weak' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
  });

  // 8. Reset password with valid OTP and strong new password -> 200
  await t.test('8. Reset password with valid OTP and strong new password succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: generatedOtp, newPassword }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.message, /Password has been reset successfully/i);
  });

  // 9. Login with OLD password fails -> 401
  await t.test('9. Attempting login with old password fails with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: initialPassword }),
    });
    assert.equal(res.status, 401);
  });

  // 10. Login with NEW password succeeds -> 200
  await t.test('10. Attempting login with new password succeeds with 200', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: newPassword }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.tokens.accessToken);
  });

  // 11. Replay prevention: OTP cannot be reused
  await t.test('11. Replay prevention: used OTP cannot be reused', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: generatedOtp, newPassword: 'AnotherPassword123!' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.message, /Invalid or expired OTP/i);
  });

  // 12. Verify audit logs recorded both events
  await t.test('12. Verify audit logs recorded reset request and success', async () => {
    const logs = await pool.query(
      'SELECT action, status FROM audit_logs WHERE metadata->>\'email\' = $1 ORDER BY created_at ASC',
      [testEmail]
    );
    const actions = logs.rows.map((l) => l.action);
    assert.ok(actions.includes('USER_PASSWORD_RESET_REQUESTED'), 'Audit log must record reset requested');
    assert.ok(actions.includes('USER_PASSWORD_RESET_SUCCESS'), 'Audit log must record reset success');
  });
});
