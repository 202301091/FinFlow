import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import http from 'http';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { sanitizeAuditMetadata } from '../src/services/audit.service.js';

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

  // Set sender initial balance
  await pool.query('UPDATE accounts SET balance = 1000.00 WHERE id = $1', [senderAccountId]);

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

test('Audit Log: Sanitizer strips sensitive credentials and tokens', () => {
  const dirtyData = {
    amount: 500,
    password: 'superSecretPassword123',
    nested: {
      password_hash: '$2b$10$...',
      token: 'jwt.token.here',
      userSecret: 'confidential_key',
      publicInfo: 'valid_data',
    },
  };

  const cleanData = sanitizeAuditMetadata(dirtyData);

  assert.equal(cleanData.amount, 500);
  assert.equal(cleanData.password, '[REDACTED]');
  assert.equal(cleanData.nested.password_hash, '[REDACTED]');
  assert.equal(cleanData.nested.token, '[REDACTED]');
  assert.equal(cleanData.nested.publicInfo, 'valid_data');
});

test('Audit Log: Successful transfer creates an audit log with requestId, user, and resource', async () => {
  const customRequestId = `trace-audit-success-${Date.now()}`;
  const idempotencyKey = `audit-key-${Date.now()}`;

  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
      'X-Request-ID': customRequestId,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 45.0,
      description: 'Audit log success test',
    }),
  });

  const body = await res.json();
  assert.equal(res.status, 200);
  const transactionId = body.data.transaction.id;

  // Query audit_logs table for this request ID
  const auditRes = await pool.query(
    'SELECT * FROM audit_logs WHERE request_id = $1',
    [customRequestId]
  );

  assert.equal(auditRes.rows.length, 1, 'Audit log row must be created');
  const audit = auditRes.rows[0];

  assert.equal(audit.user_id, senderUserId);
  assert.equal(audit.action, 'TRANSFER_COMPLETED');
  assert.equal(audit.resource_type, 'transaction');
  assert.equal(audit.resource_id, transactionId);
  assert.equal(audit.status, 'SUCCESS');
  assert.equal(audit.request_id, customRequestId);
  assert.equal(audit.metadata.amount, 45.0);
  assert.equal(audit.metadata.senderAccountId, senderAccountId);
  assert.equal(audit.metadata.receiverAccountId, receiverAccountId);
});

test('Audit Log: Failed transfer creates an audit log recording failure reason', async () => {
  const customRequestId = `trace-audit-fail-${Date.now()}`;
  const idempotencyKey = `audit-fail-key-${Date.now()}`;

  // Request ₹999,999 when balance is ~955
  const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
      'X-Request-ID': customRequestId,
    },
    body: JSON.stringify({
      senderAccountId,
      receiverAccountId,
      amount: 999999.0,
      description: 'Audit log fail test',
    }),
  });

  assert.equal(res.status, 400);

  // Query audit_logs for failure entry
  const auditRes = await pool.query(
    'SELECT * FROM audit_logs WHERE request_id = $1',
    [customRequestId]
  );

  assert.equal(auditRes.rows.length, 1, 'Audit log row must be recorded even for failed attempts');
  const audit = auditRes.rows[0];

  assert.equal(audit.user_id, senderUserId);
  assert.equal(audit.action, 'TRANSFER_FAILED');
  assert.equal(audit.resource_type, 'transaction');
  assert.equal(audit.status, 'FAILURE');
  assert.equal(audit.request_id, customRequestId);
  assert.match(audit.metadata.errorMessage, /Insufficient balance/i);
});

test('Audit Log: User registration creates an audit log', async () => {
  const customRequestId = `trace-user-reg-${Date.now()}`;
  const testEmail = `audituser${Date.now()}@example.com`;

  const res = await fetch(`${baseUrl}/api/v1/users/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': customRequestId,
    },
    body: JSON.stringify({
      name: 'Audit Test User',
      email: testEmail,
      password: 'StrongPassword123!',
    }),
  });

  const body = await res.json();
  assert.equal(res.status, 201);
  const createdUserId = body.data.id;

  const auditRes = await pool.query(
    'SELECT * FROM audit_logs WHERE request_id = $1',
    [customRequestId]
  );

  assert.equal(auditRes.rows.length, 1);
  const audit = auditRes.rows[0];
  assert.equal(audit.user_id, createdUserId);
  assert.equal(audit.action, 'USER_REGISTERED');
  assert.equal(audit.status, 'SUCCESS');
  assert.equal(audit.metadata.email, testEmail);
  // Guarantee password is not present in metadata
  assert.equal(audit.metadata.password, undefined);
});

test('Audit Log: User login records success and failure audit logs', async () => {
  const userEmail = `login${Date.now()}@example.com`;
  const userPassword = 'TestPassword123!';

  // 1. Register user
  await fetch(`${baseUrl}/api/v1/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Login User', email: userEmail, password: userPassword }),
  });

  // 2. Failed login attempt (wrong password)
  const failRequestId = `trace-login-fail-${Date.now()}`;
  const failRes = await fetch(`${baseUrl}/api/v1/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': failRequestId,
    },
    body: JSON.stringify({ email: userEmail, password: 'WrongPassword!' }),
  });
  assert.equal(failRes.status, 401);

  const failAuditRes = await pool.query(
    'SELECT * FROM audit_logs WHERE request_id = $1',
    [failRequestId]
  );
  assert.equal(failAuditRes.rows.length, 1);
  assert.equal(failAuditRes.rows[0].action, 'USER_LOGIN_FAILED');
  assert.equal(failAuditRes.rows[0].status, 'FAILURE');

  // 3. Successful login attempt
  const successRequestId = `trace-login-success-${Date.now()}`;
  const successRes = await fetch(`${baseUrl}/api/v1/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': successRequestId,
    },
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  assert.equal(successRes.status, 200);

  const successAuditRes = await pool.query(
    'SELECT * FROM audit_logs WHERE request_id = $1',
    [successRequestId]
  );
  assert.equal(successAuditRes.rows.length, 1);
  assert.equal(successAuditRes.rows[0].action, 'USER_LOGIN_SUCCESS');
  assert.equal(successAuditRes.rows[0].status, 'SUCCESS');
});

test('Audit Log: Account creation records ACCOUNT_CREATED audit log', async () => {
  // Register a fresh user who doesn't have accounts yet
  const freshEmail = `accuser${Date.now()}@example.com`;
  const regRes = await fetch(`${baseUrl}/api/v1/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Acc User', email: freshEmail, password: 'Password123!' }),
  });
  const regBody = await regRes.json();
  const freshUserId = regBody.data.id;

  const freshToken = jwt.sign(
    { id: freshUserId, name: 'Acc User', email: freshEmail },
    process.env.JWT_Access_SECRET || 'finflow_access_secret_key_2026',
    { expiresIn: '1h' }
  );

  const customRequestId = `trace-create-acc-${Date.now()}`;
  const res = await fetch(`${baseUrl}/api/v1/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${freshToken}`,
      'X-Request-ID': customRequestId,
    },
    body: JSON.stringify({
      account_type: 'current',
      balance: 1500.0,
    }),
  });

  const body = await res.json();
  assert.equal(res.status, 201);
  const createdAccountId = body.data.id;

  const auditRes = await pool.query(
    'SELECT * FROM audit_logs WHERE request_id = $1',
    [customRequestId]
  );
  assert.equal(auditRes.rows.length, 1);
  const audit = auditRes.rows[0];
  assert.equal(audit.user_id, freshUserId);
  assert.equal(audit.action, 'ACCOUNT_CREATED');
  assert.equal(audit.resource_type, 'account');
  assert.equal(audit.resource_id, createdAccountId);
  assert.equal(audit.status, 'SUCCESS');
  assert.equal(audit.metadata.accountType, 'current');
  assert.equal(audit.metadata.initialBalance, 1500.0);
});
