import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverScript = path.resolve(__dirname, '../src/index.js');
const backendRoot = path.resolve(__dirname, '..');

const PORT_NODE_1 = 5001;
const PORT_NODE_2 = 5002;
const BASE_URL_1 = `http://127.0.0.1:${PORT_NODE_1}`;
const BASE_URL_2 = `http://127.0.0.1:${PORT_NODE_2}`;

describe('Day-6 Step 11: Multi-Instance Local Execution & Load Balancing Simulation', () => {
  let child1;
  let child2;
  let child1Logs = '';
  let child2Logs = '';
  let testUserEmail = `multinode_${Date.now()}@finflow.test`;
  let testUserId;
  let authToken;
  let account1Id;
  let account2Id;

  const waitForReady = async (baseUrl, timeoutMs = 8000) => {
    const startTime = Date.now();
    let lastError = null;
    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetch(`${baseUrl}/health/ready`);
        if (res.status === 200) {
          const body = await res.json();
          if (body.data?.status === 'READY') {
            return true;
          }
        }
      } catch (err) {
        lastError = err.cause ? `${err.message} (${err.cause.code || err.cause.message || err.cause})` : err.message;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    console.error(`[Test Debug] Child1 Logs:\n${child1Logs}`);
    console.error(`[Test Debug] Child2 Logs:\n${child2Logs}`);
    throw new Error(`Timeout waiting for ${baseUrl}/health/ready to become READY. Last err: ${lastError}`);
  };

  before(async () => {
    // Spawn Node Instance 1 on PORT 5001
    child1 = fork(serverScript, [], {
      cwd: backendRoot,
      env: { ...process.env, PORT: String(PORT_NODE_1) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });
    child1.stdout.on('data', (d) => { child1Logs += d.toString(); });
    child1.stderr.on('data', (d) => { child1Logs += d.toString(); });

    // Spawn Node Instance 2 on PORT 5002
    child2 = fork(serverScript, [], {
      cwd: backendRoot,
      env: { ...process.env, PORT: String(PORT_NODE_2) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });
    child2.stdout.on('data', (d) => { child2Logs += d.toString(); });
    child2.stderr.on('data', (d) => { child2Logs += d.toString(); });

    // Wait until both independent processes pass readiness probes
    await Promise.all([
      waitForReady(BASE_URL_1),
      waitForReady(BASE_URL_2)
    ]);
  });

  after(async () => {
    // Ensure child processes are killed if test exited prematurely
    if (child1 && !child1.killed && child1.exitCode === null) {
      try { child1.send('shutdown'); } catch {}
      setTimeout(() => { try { child1.kill(); } catch {} }, 1000).unref();
    }
    if (child2 && !child2.killed && child2.exitCode === null) {
      try { child2.send('shutdown'); } catch {}
      setTimeout(() => { try { child2.kill(); } catch {} }, 1000).unref();
    }

    // Clean up test database data
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

  test('1. Multi-Node Readiness: Both OS-level processes report UP on independent ports', async () => {
    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL_1}/health/ready`),
      fetch(`${BASE_URL_2}/health/ready`)
    ]);

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res2.status, 200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    assert.strictEqual(body1.data.status, 'READY');
    assert.strictEqual(body1.data.checks.database, 'UP');
    assert.strictEqual(body1.data.checks.redis, 'UP');

    assert.strictEqual(body2.data.status, 'READY');
    assert.strictEqual(body2.data.checks.database, 'UP');
    assert.strictEqual(body2.data.checks.redis, 'UP');
  });

  test('2. Round-Robin Load Execution: Operations split across Node 1 & Node 2 share state consistently', async () => {
    // Step A: Register user via Node 1
    const regRes = await fetch(`${BASE_URL_1}/api/v1/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'MultiNode Tester',
        email: testUserEmail,
        password: 'Password123!'
      })
    });
    assert.strictEqual(regRes.status, 201);
    const regData = await regRes.json();
    testUserId = regData.data.id;
    assert.ok(testUserId, 'User created via Node 1');

    // Step B: Authenticate via Node 2 to obtain JWT
    const loginRes = await fetch(`${BASE_URL_2}/api/v1/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        password: 'Password123!'
      })
    });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    authToken = loginData.data.tokens.accessToken;
    assert.ok(authToken, 'Auth token received from Node 2');

    // Step C: Create Account 1 via Node 2 (Load Balancing across nodes)
    const acc1Res = await fetch(`${BASE_URL_2}/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        account_type: 'checking',
        balance: 1000.00
      })
    });
    assert.strictEqual(acc1Res.status, 201);
    const acc1Data = await acc1Res.json();
    account1Id = acc1Data.data.id;

    // Step D: Create Account 2 via Node 1
    const acc2Res = await fetch(`${BASE_URL_1}/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        account_type: 'savings',
        balance: 200.00
      })
    });
    assert.strictEqual(acc2Res.status, 201);
    const acc2Data = await acc2Res.json();
    account2Id = acc2Data.data.id;

    // Step E: Execute Transfer of 350.00 from Account 1 to Account 2 via Node 1 with Idempotency Key
    const idemKey = `idem-cross-node-${Date.now()}`;
    const tx1Res = await fetch(`${BASE_URL_1}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Idempotency-Key': idemKey
      },
      body: JSON.stringify({
        senderAccountId: account1Id,
        receiverAccountId: account2Id,
        amount: 350.00,
        description: 'Multi-node test transfer'
      })
    });
    assert.strictEqual(tx1Res.status, 200);
    const tx1Data = await tx1Res.json();
    assert.strictEqual(tx1Data.success, true);
    const transactionId = tx1Data.data.id;

    // Step F: Retry EXACT same transfer request via Node 2 with identical Idempotency Key
    const tx2Res = await fetch(`${BASE_URL_2}/api/v1/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Idempotency-Key': idemKey
      },
      body: JSON.stringify({
        senderAccountId: account1Id,
        receiverAccountId: account2Id,
        amount: 350.00,
        description: 'Multi-node test transfer'
      })
    });
    // Must return cached response with same transaction ID
    assert.strictEqual(tx2Res.status, 200);
    const tx2Data = await tx2Res.json();
    assert.strictEqual(tx2Data.data.id, transactionId, 'Distributed idempotency key shared across independent Node processes');

    // Step G: Query accounts on Node 1 (Check balance consistency)
    const listRes1 = await fetch(`${BASE_URL_1}/api/v1/accounts`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.strictEqual(listRes1.status, 200);
    const listData1 = await listRes1.json();
    const node1Acc1 = listData1.data.find((a) => a.id === account1Id);
    const node1Acc2 = listData1.data.find((a) => a.id === account2Id);
    assert.strictEqual(Number(node1Acc1.balance), 650.00);
    assert.strictEqual(Number(node1Acc2.balance), 550.00);

    // Step H: Query accounts on Node 2 (Verify cache invalidation propagates across nodes)
    const listRes2 = await fetch(`${BASE_URL_2}/api/v1/accounts`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    assert.strictEqual(listRes2.status, 200);
    const listData2 = await listRes2.json();
    const node2Acc1 = listData2.data.find((a) => a.id === account1Id);
    const node2Acc2 = listData2.data.find((a) => a.id === account2Id);
    assert.strictEqual(Number(node2Acc1.balance), 650.00);
    assert.strictEqual(Number(node2Acc2.balance), 550.00);
  });

  test('3. Graceful Process Teardown: Both OS processes exit cleanly with code 0 upon shutdown signal', async () => {
    const waitForExit = (child) => {
      return new Promise((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.on('exit', (code) => resolve(code));
      });
    };

    // Send graceful shutdown signal via IPC to both processes
    child1.send('shutdown');
    child2.send('shutdown');

    const [code1, code2] = await Promise.all([
      waitForExit(child1),
      waitForExit(child2)
    ]);

    assert.strictEqual(code1, 0, 'Node instance 1 exited cleanly with code 0');
    assert.strictEqual(code2, 0, 'Node instance 2 exited cleanly with code 0');

    assert.ok(child1Logs.includes('Graceful shutdown completed cleanly.'), 'Node 1 logged clean shutdown');
    assert.ok(child2Logs.includes('Graceful shutdown completed cleanly.'), 'Node 2 logged clean shutdown');
  });
});
