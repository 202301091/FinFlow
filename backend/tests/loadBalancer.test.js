import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const serverScript = path.resolve(__dirname, '../src/index.js');
const lbScript = path.resolve(__dirname, '../src/load-balancer.js');

const PORT_LB = 5555;
const PORT_NODE_1 = 5001;
const PORT_NODE_2 = 5002;
const LB_URL = `http://127.0.0.1:${PORT_LB}`;

describe('Day-6 Step 11: Load Balancer & Reverse Proxy Verification', () => {
  let child1;
  let child2;
  let childLb;

  const waitForHttp = async (url, timeoutMs = 8000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetch(url);
        if (res.status === 200) return true;
      } catch (err) {
        // Retry until listening
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for ${url}`);
  };

  before(async () => {
    // 1. Spawn Node Instance 1 on PORT 5001
    child1 = fork(serverScript, [], {
      cwd: backendRoot,
      env: { ...process.env, PORT: String(PORT_NODE_1) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    // 2. Spawn Node Instance 2 on PORT 5002
    child2 = fork(serverScript, [], {
      cwd: backendRoot,
      env: { ...process.env, PORT: String(PORT_NODE_2) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    // Wait for backend nodes to be ready
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${PORT_NODE_1}/health/live`),
      waitForHttp(`http://127.0.0.1:${PORT_NODE_2}/health/live`),
    ]);

    // 3. Spawn Load Balancer on PORT 5555 targeting 5001 and 5002
    childLb = fork(lbScript, [], {
      cwd: backendRoot,
      env: {
        ...process.env,
        LB_PORT: String(PORT_LB),
        TARGETS: `http://127.0.0.1:${PORT_NODE_1},http://127.0.0.1:${PORT_NODE_2}`,
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    // Wait for Load Balancer to accept connections
    await waitForHttp(`${LB_URL}/health/live`);
  });

  after(async () => {
    // Defensive teardown of all child processes
    const terminate = (child) => {
      if (child && !child.killed && child.exitCode === null) {
        if (child.connected) {
          try { child.send('shutdown'); } catch {}
        }
        setTimeout(() => { try { child.kill(); } catch {} }, 500).unref();
      }
    };
    terminate(childLb);
    terminate(child1);
    terminate(child2);
  });

  test('1. Round-Robin Distribution: Requests to Load Balancer alternate across backend instances', async () => {
    const responses = [];

    // Send 4 requests through the Load Balancer
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${LB_URL}/health/live`);
      assert.strictEqual(res.status, 200);
      const servedBy = res.headers.get('x-served-by');
      responses.push(servedBy);
    }

    // Verify round-robin alternating pattern across both nodes
    assert.notStrictEqual(responses[0], responses[1], 'Consecutive requests route to different targets');
    assert.strictEqual(responses[0], responses[2], 'Request 1 and 3 route to the same target');
    assert.strictEqual(responses[1], responses[3], 'Request 2 and 4 route to the same target');

    const targetSet = new Set(responses);
    assert.strictEqual(targetSet.size, 2, 'Both nodes received traffic');
    assert.ok(targetSet.has(String(PORT_NODE_1)), 'Node 1 received traffic');
    assert.ok(targetSet.has(String(PORT_NODE_2)), 'Node 2 received traffic');
  });

  test('2. Proxy Headers: Load Balancer preserves client headers and forwards request paths correctly', async () => {
    const res = await fetch(`${LB_URL}/health/ready`, {
      headers: {
        'X-Custom-Client-Test': 'finflow-lb-verification',
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'READY');
    assert.strictEqual(body.data.checks.database, 'UP');
    assert.strictEqual(body.data.checks.redis, 'UP');
  });

  test('3. Clean Teardown: Load Balancer shuts down cleanly without lingering sockets', async () => {
    const waitForExit = (child) => {
      return new Promise((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.on('exit', (code) => resolve(code));
      });
    };

    childLb.send('shutdown');
    const exitCode = await waitForExit(childLb);
    assert.strictEqual(exitCode, 0, 'Load balancer exited with code 0');
  });
});
