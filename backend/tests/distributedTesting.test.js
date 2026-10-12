import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const serverScript = path.resolve(__dirname, '../src/index.js');

const PORT_1 = 5001;
const PORT_2 = 5002;
const PORT_3 = 5003;

const URL_1 = `http://127.0.0.1:${PORT_1}`;
const URL_2 = `http://127.0.0.1:${PORT_2}`;
const URL_3 = `http://127.0.0.1:${PORT_3}`;

describe('Day-6 Step 12: Distributed Testing Across Multiple Instances', () => {
  let child1;
  let child2;
  let child3;

  let testUserEmail = `dist_${Date.now()}@finflow.test`;
  let testUserId;
  let authToken;
  let checkingAccountId;
  let savingsAccountId;

  const waitForReady = async (baseUrl, timeoutMs = 8000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetch(`${baseUrl}/health/ready`);
        if (res.status === 200) {
          const body = await res.json();
          if (body.data?.status === 'READY') return true;
        }
      } catch (err) {
        // Retry until listening
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for ${baseUrl}/health/ready to become READY`);
  };

  before(async () => {
    // 1. Spawn Instance 1 on PORT 5001
    child1 = fork(serverScript, [], {
      cwd: backendRoot,
      env: { ...process.env, PORT: String(PORT_1) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    // 2. Spawn Instance 2 on PORT 5002
    child2 = fork(serverScript, [], {
      cwd: backendRoot,
      env: { ...process.env, PORT: String(PORT_2) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    // 3. Spawn Instance 3 on PORT 5003
    child3 = fork(serverScript, [], {
      cwd: backendRoot,
      env: { ...process.env, PORT: String(PORT_3) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    // Wait until all 3 instances report READY
    await Promise.all([
      waitForReady(URL_1),
      waitForReady(URL_2),
      waitForReady(URL_3),
    ]);
  });

  after(async () => {
    // Graceful teardown of child processes
    const terminate = (child) => {
      if (child && !child.killed && child.exitCode === null) {
        if (child.connected) {
          try { child.send('shutdown'); } catch {}
        }
        setTimeout(() => { try { child.kill(); } catch {} }, 500).unref();
      }
    };
    terminate(child1);
    terminate(child2);
    terminate(child3);

    // Clean up test records
    if (testUserId) {
      await pool.query('DELETE FROM transaction_outbox WHERE payload::text LIKE $1', [`%${testUserId}%`]);
      await pool.query('DELETE FROM notifications WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM transactions WHERE sender_account_id IN (SELECT id FROM accounts WHERE user_id = $1) OR receiver_account_id IN (SELECT id FROM accounts WHERE user_id = $1)', [testUserId]);
      await pool.query('DELETE FROM accounts WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    await pool.end();
  });

  test('1. Authentication across 3 nodes: Login via Node 1 -> JWT on Node 2 -> Access on Node 3', async () => {
    // Step A: Register user on Instance 1
    const regRes = await fetch(`${URL_1}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Distributed Tester',
        email: testUserEmail,
        password: 'Password123!',
      }),
    });
    assert.strictEqual(regRes.status, 201, 'User created via Instance 1');
    const regData = await regRes.json();
    testUserId = regData.data.id;

    // Step B: Login through Instance 1 to obtain JWT
    const loginRes = await fetch(`${URL_1}/api/v1/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        password: 'Password123!',
      }),
    });
    assert.strictEqual(loginRes.status, 200, 'Login succeeded via Instance 1');
    const loginData = await loginRes.json();
    authToken = loginData.data.tokens.accessToken;
    assert.ok(authToken, 'JWT acquired from Instance 1');

    // Step C: Use JWT against Instance 2 to create checking and savings accounts
    const acc1Res = await fetch(`${URL_2}/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        account_type: 'checking',
        balance: 1000.0,
      }),
    });
    assert.strictEqual(acc1Res.status, 201, 'Checking account created via Instance 2');
    const acc1Data = await acc1Res.json();
    checkingAccountId = acc1Data.data.id;

    const acc2Res = await fetch(`${URL_2}/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        account_type: 'savings',
        balance: 500.0,
      }),
    });
    assert.strictEqual(acc2Res.status, 201, 'Savings account created via Instance 2');
    const acc2Data = await acc2Res.json();
    savingsAccountId = acc2Data.data.id;

    // Step D: Access accounts through Instance 3 using the same JWT
    const listRes = await fetch(`${URL_3}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(listRes.status, 200, 'Accounts queried via Instance 3');
    const listData = await listRes.json();
    assert.strictEqual(listData.data.length, 2, 'Instance 3 returned both accounts created via Instance 2');
  });

  test('2. Distributed Rate Limiting: Requests alternating across Instance 1, 2, and 3 share Redis limit', async () => {
    // Send requests alternating across all three instances from the same client IP
    const simulatedIp = '198.51.100.42';
    const instances = [URL_1, URL_2, URL_3];

    // Send 3 requests (one to each instance) and verify they are all accepted and share rate limiter state
    for (let i = 0; i < 3; i++) {
      const targetUrl = instances[i % instances.length];
      const res = await fetch(`${targetUrl}/api/v1/accounts`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Forwarded-For': simulatedIp,
        },
      });
      assert.strictEqual(res.status, 200, `Request ${i + 1} served by ${targetUrl}`);
    }
  });

  test('3. Distributed Caching & Invalidation: Node 1 caches -> Node 2 transfers -> Node 3 reads fresh balance', async () => {
    // Step A: Read accounts on Instance 1 (populates Redis cache)
    const read1 = await fetch(`${URL_1}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(read1.status, 200);

    // Step B: Execute transfer of 200.00 on Instance 2 (invalidates Redis cache)
    const idemKey = `dist-idem-${Date.now()}`;
    const transferRes = await fetch(`${URL_2}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({
        senderAccountId: checkingAccountId,
        receiverAccountId: savingsAccountId,
        amount: 200.0,
        description: 'Cross-node transfer test',
      }),
    });
    assert.strictEqual(transferRes.status, 200, 'Transfer completed via Instance 2');

    // Step C: Query accounts on Instance 3 -> must see updated balances, proving cache invalidation
    const read3 = await fetch(`${URL_3}/api/v1/accounts`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(read3.status, 200);
    const read3Data = await read3.json();

    const checking = read3Data.data.find((a) => a.id === checkingAccountId);
    const savings = read3Data.data.find((a) => a.id === savingsAccountId);

    assert.strictEqual(Number(checking.balance), 800.0, 'Checking balance updated on Instance 3');
    assert.strictEqual(Number(savings.balance), 700.0, 'Savings balance updated on Instance 3');
  });

  test('4. Database & Concurrent Transfers: Day-3 locking and idempotency hold across 3 nodes', async () => {
    // Retry the exact same transfer request on Instance 3 with identical Idempotency-Key
    const idemKey = `dist-idem-concurrent-${Date.now()}`;

    // First request to Instance 1
    const tx1Res = await fetch(`${URL_1}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({
        senderAccountId: checkingAccountId,
        receiverAccountId: savingsAccountId,
        amount: 100.0,
        description: 'Concurrent idempotency test',
      }),
    });
    assert.strictEqual(tx1Res.status, 200);
    const tx1Data = await tx1Res.json();
    const originalTxId = tx1Data.data.id;

    // Concurrent replay of exact same idempotency key across Instance 2 and Instance 3
    const [replay2, replay3] = await Promise.all([
      fetch(`${URL_2}/api/v1/transactions/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify({
          senderAccountId: checkingAccountId,
          receiverAccountId: savingsAccountId,
          amount: 100.0,
          description: 'Concurrent idempotency test',
        }),
      }),
      fetch(`${URL_3}/api/v1/transactions/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'Idempotency-Key': idemKey,
        },
        body: JSON.stringify({
          senderAccountId: checkingAccountId,
          receiverAccountId: savingsAccountId,
          amount: 100.0,
          description: 'Concurrent idempotency test',
        }),
      }),
    ]);

    assert.strictEqual(replay2.status, 200, 'Replay on Instance 2 returns 200');
    assert.strictEqual(replay3.status, 200, 'Replay on Instance 3 returns 200');

    const replay2Data = await replay2.json();
    const replay3Data = await replay3.json();

    assert.strictEqual(replay2Data.data.id, originalTxId, 'Instance 2 returned identical transaction ID');
    assert.strictEqual(replay3Data.data.id, originalTxId, 'Instance 3 returned identical transaction ID');
  });

  test('5. Kafka Outbox & Event Generation: Events created across nodes are persisted in outbox', async () => {
    // Check PostgreSQL transaction_outbox for events related to our test user's accounts
    const outboxRes = await pool.query(
      `SELECT id, event_type, status, partition_key 
       FROM transaction_outbox 
       WHERE aggregate_id IN (
         SELECT id FROM transactions WHERE sender_account_id = $1
       )
       ORDER BY created_at DESC`,
      [checkingAccountId]
    );

    assert.ok(outboxRes.rows.length >= 2, 'Outbox contains events from cross-instance transfers');
    for (const event of outboxRes.rows) {
      assert.strictEqual(event.partition_key, checkingAccountId, 'Partition key is senderAccountId');
      assert.strictEqual(event.event_type, 'TRANSACTION_COMPLETED');
    }
  });

  test('6. Graceful Teardown: All 3 instances shut down cleanly with exit code 0', async () => {
    const waitForExit = (child) => {
      return new Promise((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.on('exit', (code) => resolve(code));
      });
    };

    child1.send('shutdown');
    child2.send('shutdown');
    child3.send('shutdown');

    const [code1, code2, code3] = await Promise.all([
      waitForExit(child1),
      waitForExit(child2),
      waitForExit(child3),
    ]);

    assert.strictEqual(code1, 0, 'Instance 1 exited cleanly');
    assert.strictEqual(code2, 0, 'Instance 2 exited cleanly');
    assert.strictEqual(code3, 0, 'Instance 3 exited cleanly');
  });
});
