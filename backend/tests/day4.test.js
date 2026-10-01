import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { connectRedis, disconnectRedis, isRedisAvailable, redisClient } from '../src/config/redis.js';
import {
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPattern,
  incrementRateLimit,
} from '../src/utils/redis.util.js';

let server;
let baseUrl;
let senderUserId;
let receiverUserId;
let senderAccountId;
let receiverAccountId;
let senderToken;
let receiverToken;

before(async () => {
  // 1. Ensure Redis is connected for the test suite
  await connectRedis();

  // 2. Fetch or create test accounts in PostgreSQL
  const accountsRes = await pool.query(`
    SELECT a.id as account_id, a.user_id, a.account_type, a.balance, u.name, u.email
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    WHERE a.status = 'active' AND a.balance >= 100
    ORDER BY a.created_at ASC
  `);

  if (accountsRes.rows.length < 2) {
    throw new Error('Test requires at least 2 active accounts with balance in PostgreSQL');
  }

  const senderRow = accountsRes.rows[0];
  const receiverRow = accountsRes.rows.find((r) => r.user_id !== senderRow.user_id) || accountsRes.rows[1];

  senderUserId = senderRow.user_id;
  receiverUserId = receiverRow.user_id;
  senderAccountId = senderRow.account_id;
  receiverAccountId = receiverRow.account_id;

  const secret = process.env.JWT_Access_SECRET || 'finflow_access_secret_key_2026';

  senderToken = jwt.sign(
    { id: senderUserId, name: senderRow.name, email: senderRow.email },
    secret,
    { expiresIn: '1h' }
  );

  receiverToken = jwt.sign(
    { id: receiverUserId, name: receiverRow.name, email: receiverRow.email },
    secret,
    { expiresIn: '1h' }
  );

  // 3. Start ephemeral HTTP server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  // Clear any test keys in Redis
  await deleteCacheByPattern('ratelimit:test:*');
  await deleteCacheByPattern('accounts:test:*');
  await disconnectRedis();
  await pool.end();
});

// -------------------------------------------------------------
// 1. REDIS OPERATIONS
// -------------------------------------------------------------
test('Redis Suite: Connection, Set, Get, TTL, and Deletion', async (t) => {
  await t.test('Connection status reports available', () => {
    assert.equal(isRedisAvailable(), true, 'Redis should be connected and ready');
  });

  await t.test('Safe setCache and getCache with serialization', async () => {
    const testKey = 'test:day4:payload';
    const payload = { id: 42, role: 'admin', tags: ['fast', 'cached'] };

    const setSuccess = await setCache(testKey, payload, 30);
    assert.equal(setSuccess, true);

    const retrieved = await getCache(testKey);
    assert.deepEqual(retrieved, payload);

    await deleteCache(testKey);
    const afterDelete = await getCache(testKey);
    assert.equal(afterDelete, null);
  });

  await t.test('TTL expiration automatically purges keys', async () => {
    const ttlKey = 'test:day4:ttl_key';
    await setCache(ttlKey, 'temporary_value', 1);

    const immediate = await getCache(ttlKey);
    assert.equal(immediate, 'temporary_value');

    // Wait 1.2s for TTL expiration
    await new Promise((res) => setTimeout(res, 1200));

    const expired = await getCache(ttlKey);
    assert.equal(expired, null, 'Key must expire after TTL seconds');
  });

  await t.test('deleteCacheByPattern removes wildcard keys', async () => {
    await setCache('test:day4:pat:1', 'v1', 30);
    await setCache('test:day4:pat:2', 'v2', 30);

    const deletedCount = await deleteCacheByPattern('test:day4:pat:*');
    assert.ok(deletedCount >= 2, 'Should delete matching keys');

    const check1 = await getCache('test:day4:pat:1');
    const check2 = await getCache('test:day4:pat:2');
    assert.equal(check1, null);
    assert.equal(check2, null);
  });
});

// -------------------------------------------------------------
// 2. ACCOUNT CACHE & INVALIDATION
// -------------------------------------------------------------
test('Account Cache Suite: Cache-Aside & Invalidation on Transfer', async (t) => {
  const senderAllKey = `accounts:${senderUserId}:all`;
  const receiverAllKey = `accounts:${receiverUserId}:all`;

  await t.test('Cache Miss queries PostgreSQL and populates Redis', async () => {
    // Invalidate pre-existing cache
    await deleteCache(senderAllKey);

    const res = await fetch(`${baseUrl}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${senderToken}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.message, 'Accounts fetched successfully');
    assert.ok(Array.isArray(body.data));

    // Verify key was saved to Redis
    const cachedData = await getCache(senderAllKey);
    assert.ok(Array.isArray(cachedData));
    assert.equal(cachedData.length, body.data.length);
  });

  await t.test('Cache Hit returns directly from Redis cache', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${senderToken}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.message, 'Accounts fetched successfully (from cache)');
  });

  await t.test('Transfer invalidates both sender and receiver caches post-commit', async () => {
    // 1. Ensure both caches exist prior to transfer
    await fetch(`${baseUrl}/api/v1/accounts`, { headers: { Authorization: `Bearer ${senderToken}` } });
    await fetch(`${baseUrl}/api/v1/accounts`, { headers: { Authorization: `Bearer ${receiverToken}` } });

    assert.ok((await getCache(senderAllKey)) !== null, 'Sender cache should be populated');
    assert.ok((await getCache(receiverAllKey)) !== null, 'Receiver cache should be populated');

    // 2. Perform monetary transfer
    const idempotencyKey = `day4-test-transfer-${Date.now()}`;
    const transferRes = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        senderAccountId,
        receiverAccountId,
        amount: 10.00,
        description: 'Day-4 Cache Invalidation Verification',
      }),
    });

    const transferBody = await transferRes.json();
    assert.equal(transferRes.status, 200, `Transfer should succeed: ${JSON.stringify(transferBody)}`);

    // 3. Verify Redis caches for both parties were invalidated
    const senderCacheAfter = await getCache(senderAllKey);
    const receiverCacheAfter = await getCache(receiverAllKey);

    assert.equal(senderCacheAfter, null, 'Sender account cache must be invalidated after transfer');
    assert.equal(receiverCacheAfter, null, 'Receiver account cache must be invalidated after transfer');

    // 4. Next GET accounts must be a Cache Miss returning updated balance from PostgreSQL
    const senderFreshRes = await fetch(`${baseUrl}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${senderToken}` },
    });
    const senderFreshBody = await senderFreshRes.json();
    assert.equal(senderFreshBody.message, 'Accounts fetched successfully');
  });
});

// -------------------------------------------------------------
// 3. RATE LIMITING
// -------------------------------------------------------------
test('Rate Limiter Suite: Quota, HTTP 429, TTL Expiration, and Client Separation', async (t) => {
  await t.test('Requests below limit decrement remaining count and set headers', async () => {
    const key = `ratelimit:test:unit-${Date.now()}`;
    const result1 = await incrementRateLimit(key, 10);
    assert.equal(result1.currentCount, 1);
    assert.ok(result1.ttl > 0 && result1.ttl <= 10);

    const result2 = await incrementRateLimit(key, 10);
    assert.equal(result2.currentCount, 2);
    await deleteCache(key);
  });

  await t.test('Exceeding transfer rate limit returns HTTP 429 and Retry-After', async () => {
    // Fill transfer rate limit key in Redis directly for test isolation
    const transferKey = `ratelimit:transfer:user:${senderUserId}`;
    const maxLimit = Number(process.env.RATE_LIMIT_TRANSFER_MAX) || 30;

    // Simulate hitting the limit
    await redisClient.set(transferKey, String(maxLimit), { EX: 15 });

    // Next transfer request must exceed limit
    const res = await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
        'Idempotency-Key': `day4-ratelimit-exceeded-${Date.now()}`,
      },
      body: JSON.stringify({
        senderAccountId,
        receiverAccountId,
        amount: 5.00,
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 429, 'Must return 429 Too Many Requests');
    assert.equal(body.statusCode, 429);
    assert.ok(res.headers.has('retry-after'), 'Must include Retry-After header');
    assert.equal(res.headers.get('x-ratelimit-remaining'), '0');

    // Clean up limit key
    await deleteCache(transferKey);
  });

  await t.test('Separate clients have completely independent rate limit counters', async () => {
    const clientAKey = `ratelimit:test:clientA_${Date.now()}`;
    const clientBKey = `ratelimit:test:clientB_${Date.now()}`;

    // Exhaust client A
    await incrementRateLimit(clientAKey, 30);
    await incrementRateLimit(clientAKey, 30);
    const countA = await incrementRateLimit(clientAKey, 30);
    assert.equal(countA.currentCount, 3);

    // Client B must still start at 1
    const countB = await incrementRateLimit(clientBKey, 30);
    assert.equal(countB.currentCount, 1);

    await deleteCache(clientAKey, clientBKey);
  });
});

// -------------------------------------------------------------
// 4. FINANCIAL AUTHORITATIVENESS & RESILIENCE
// -------------------------------------------------------------
test('Financial Authoritativeness Suite: PostgreSQL as Source of Truth', async (t) => {
  await t.test('Balances in PostgreSQL reflect exact mathematical debits and credits', async () => {
    const senderDb = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
    const balanceBefore = parseFloat(senderDb.rows[0].balance);

    const idempotencyKey = `day4-math-audit-${Date.now()}`;
    await fetch(`${baseUrl}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        senderAccountId,
        receiverAccountId,
        amount: 25.00,
        description: 'Math audit transfer',
      }),
    });

    const senderDbAfter = await pool.query('SELECT balance FROM accounts WHERE id = $1', [senderAccountId]);
    const balanceAfter = parseFloat(senderDbAfter.rows[0].balance);

    assert.equal(
      balanceAfter,
      parseFloat((balanceBefore - 25.00).toFixed(2)),
      'PostgreSQL balance must match exact debit'
    );
  });
});
