import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { pool } from '../src/config/db.js';
import { connectRedis, disconnectRedis, redisClient, redisSubscriber } from '../src/config/redis.js';

describe('Day-6 Step 9: Redis Distributed State Across Multiple Instances', () => {
  let serverA;
  let serverB;
  let baseUrlA;
  let baseUrlB;

  let senderUserId;
  let senderAccountId;
  let receiverUserId;
  let receiverAccountId;
  let senderToken;

  before(async () => {
    await connectRedis();

    // 1. Fetch two active accounts
    const accRes = await pool.query(`
      SELECT a.id, a.user_id, a.account_type, a.balance, u.name, u.email
      FROM accounts a
      JOIN users u ON a.user_id = u.id
      WHERE a.status = 'active' AND a.balance >= 500
      LIMIT 2
    `);

    if (accRes.rows.length < 2) {
      throw new Error('Test requires at least 2 active accounts with balance >= 500');
    }

    const sRow = accRes.rows[0];
    const rRow = accRes.rows[1];

    senderUserId = sRow.user_id;
    senderAccountId = sRow.id;
    receiverUserId = rRow.user_id;
    receiverAccountId = rRow.id;

    const secret = process.env.JWT_Access_SECRET || 'finflow_access_secret_key_2026';
    senderToken = jwt.sign(
      { id: senderUserId, name: sRow.name, email: sRow.email },
      secret,
      { expiresIn: '1h' }
    );

    // 2. Start two distinct HTTP servers on ephemeral ports representing Instance A and Instance B
    serverA = http.createServer(app);
    await new Promise((resolve) => serverA.listen(0, resolve));
    baseUrlA = `http://127.0.0.1:${serverA.address().port}`;

    serverB = http.createServer(app);
    await new Promise((resolve) => serverB.listen(0, resolve));
    baseUrlB = `http://127.0.0.1:${serverB.address().port}`;
  });

  after(async () => {
    try {
      if (redisSubscriber && redisSubscriber.isOpen) {
        await redisSubscriber.unsubscribe();
      }
    } catch {}
    if (serverA) {
      serverA.closeAllConnections?.();
      await new Promise((resolve) => serverA.close(resolve));
    }
    if (serverB) {
      serverB.closeAllConnections?.();
      await new Promise((resolve) => serverB.close(resolve));
    }
    await disconnectRedis();
    await pool.end();
  });

  test('Distributed Cache: Cache populated by Instance A is immediately read as a HIT by Instance B', async () => {
    // Clear any previous cache for this user
    await redisClient.del(`accounts:${senderUserId}:all`);

    // Request from Instance A (generates Cache MISS -> queries PG -> sets Redis cache)
    const resA = await fetch(`${baseUrlA}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${senderToken}` },
    });
    assert.equal(resA.status, 200);
    const dataA = await resA.json();
    assert.ok(dataA.data.length > 0);

    // Verify key exists in Redis
    const cachedData = await redisClient.get(`accounts:${senderUserId}:all`);
    assert.ok(cachedData, 'Cache key must be populated in shared Redis');

    // Request from Instance B (should be a Cache HIT from Redis)
    const resB = await fetch(`${baseUrlB}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${senderToken}` },
    });
    assert.equal(resB.status, 200);
    const dataB = await resB.json();

    assert.equal(dataB.message, 'Accounts fetched successfully (from cache)');
    assert.deepEqual(dataB.data, JSON.parse(cachedData));
  });

  test('Distributed Invalidation: Transfer executed on Instance A invalidates cache read by Instance B', async () => {
    // 1. Warm cache on Instance B
    await fetch(`${baseUrlB}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${senderToken}` },
    });

    const cachedBefore = await redisClient.get(`accounts:${senderUserId}:all`);
    assert.ok(cachedBefore, 'Cache must be populated before transfer');

    // 2. Execute transfer on Instance A
    const transferRes = await fetch(`${baseUrlA}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
        'Idempotency-Key': `dist-cache-inv-${Date.now()}`,
      },
      body: JSON.stringify({
        senderAccountId,
        receiverAccountId,
        amount: 10.0,
        description: 'Multi-instance cache invalidation test',
      }),
    });
    assert.equal(transferRes.status, 200);

    // 3. Verify Redis cache was invalidated by Instance A post-commit
    const cachedAfter = await redisClient.get(`accounts:${senderUserId}:all`);
    assert.equal(cachedAfter, null, 'Cache key must be cleared from Redis post-commit');

    // 4. Query balance on Instance B (must read fresh balance from PG, not stale cache)
    const resAfterB = await fetch(`${baseUrlB}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${senderToken}` },
    });
    assert.equal(resAfterB.status, 200);
    const dataAfterB = await resAfterB.json();

    assert.equal(dataAfterB.message, 'Accounts fetched successfully');
  });

  test('Distributed Rate Limiting: Requests split between Instance A and Instance B share the central limit', async () => {
    // Use an unauthenticated IP endpoint to isolate a specific simulated test IP
    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
    const rlKey = `ratelimit:login:ip:${testIp}`;
    await redisClient.del(rlKey);

    // Pre-seed counter to 19 (threshold is 20 for login rate limit)
    await redisClient.setEx(rlKey, 60, '19');

    // Request 20 sent to Instance A (should pass as the 20th allowed request)
    const res1 = await fetch(`${baseUrlA}/api/v1/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': testIp,
      },
      body: JSON.stringify({ email: 'bad@login.test', password: 'bad' }),
    });
    // Regardless of 400/401 credentials failure, rate limiter allowed it (not 429)
    assert.notEqual(res1.status, 429, '20th request must not be rate limited');

    // Request 21 sent to Instance B (must be blocked as HTTP 429 because Instance A incremented Redis)
    const res2 = await fetch(`${baseUrlB}/api/v1/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': testIp,
      },
      body: JSON.stringify({ email: 'bad@login.test', password: 'bad' }),
    });
    assert.equal(res2.status, 429, '21st request routed to Instance B must be rate limited with HTTP 429');

    // Clean up
    await redisClient.del(rlKey);
  });

  test('Cross-Instance Pub/Sub: Transfer dispatched on Instance A delivers live SSE event on Instance B', async () => {
    // 1. Client connects to Instance B's SSE stream via http.request
    let resolveConnected;
    const connectedPromise = new Promise((resolve) => {
      resolveConnected = resolve;
    });

    let resolveLiveEvent;
    const liveEventPromise = new Promise((resolve) => {
      resolveLiveEvent = resolve;
    });

    const sseReq = http.request(
      `${baseUrlB}/api/v1/notifications/stream?token=${encodeURIComponent(senderToken)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${senderToken}`,
        },
      },
      (res) => {
        assert.equal(res.statusCode, 200);

        res.on('data', (chunk) => {
          const raw = chunk.toString();
          const lines = raw.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.replace('data: ', '').trim());
                if (parsed.type === 'CONNECTED') {
                  resolveConnected(parsed);
                } else if (parsed.type === 'TRANSFER_SENT') {
                  resolveLiveEvent(parsed);
                }
              } catch {}
            }
          }
        });
      }
    );

    sseReq.end();

    // Wait for connection confirmation
    await connectedPromise;

    // 2. Trigger transfer on Instance A
    await fetch(`${baseUrlA}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${senderToken}`,
        'Idempotency-Key': `dist-sse-${Date.now()}`,
      },
      body: JSON.stringify({
        senderAccountId,
        receiverAccountId,
        amount: 5.0,
        description: 'Multi-instance SSE broadcast test',
      }),
    });

    // 3. Instance B's SSE reader must receive the published notification event
    const liveEvent = await liveEventPromise;
    assert.equal(liveEvent.type, 'TRANSFER_SENT');

    // Clean up socket
    sseReq.destroy();
  });
});
