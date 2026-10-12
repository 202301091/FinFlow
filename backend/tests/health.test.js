import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';

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
});

test('Health: GET /health returns 200 OK with UP status and process uptime', async () => {
  const res = await fetch(`${baseUrl}/health`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.statusCode, 200);
  assert.equal(body.data.status, 'UP');
  assert.equal(typeof body.data.uptime, 'number');
  assert.ok(res.headers.has('x-request-id'), 'Response must include X-Request-ID header');
});

test('Health: GET /health/live returns 200 OK as a fast shallow liveness probe', async () => {
  const res = await fetch(`${baseUrl}/health/live`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.statusCode, 200);
  assert.equal(body.data.status, 'UP');
  assert.equal(typeof body.data.uptime, 'number');
});

test('Health: GET /health/ready returns 200 with deep checks for database and redis', async () => {
  const res = await fetch(`${baseUrl}/health/ready`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.statusCode, 200);
  assert.equal(body.data.status, 'READY');
  assert.equal(body.data.checks.database, 'UP');
  assert.ok(
    body.data.checks.redis === 'UP' || body.data.checks.redis === 'DEGRADED',
    'Redis check must report UP or DEGRADED gracefully'
  );
});

import logger from '../src/config/logger.js';

test('Logger: HTTP Request Log format contains only required fields without leaking sensitive data', async () => {
  let loggedPayload = null;
  const originalInfo = logger.info.bind(logger);

  logger.info = (payload, ...args) => {
    if (payload && typeof payload === 'object' && payload.requestId === 'test-audit-schema-check') {
      loggedPayload = payload;
    }
    return originalInfo(payload, ...args);
  };

  try {
    await fetch(`${baseUrl}/health`, {
      headers: {
        'x-request-id': 'test-audit-schema-check',
        'authorization': 'Bearer super-secret-token-must-not-leak',
        'cookie': 'session=secret-cookie-value',
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(loggedPayload, 'Target HTTP request log payload must be captured');

    // 1. Verify required fields exist
    assert.equal(loggedPayload.requestId, 'test-audit-schema-check', 'Must include matching requestId');
    assert.equal(loggedPayload.method, 'GET', 'Must include HTTP method');
    assert.equal(loggedPayload.route, '/health', 'Must include route');
    assert.equal(loggedPayload.statusCode, 200, 'Must include statusCode');
    assert.ok(loggedPayload.duration, 'Must include duration');

    // 2. Verify forbidden / bloated fields are NOT present
    assert.equal(loggedPayload.pid, undefined, 'PID must be stripped');
    assert.equal(loggedPayload.hostname, undefined, 'Hostname must be stripped');
    assert.equal(loggedPayload.headers, undefined, 'Raw headers must not be logged');
    assert.equal(loggedPayload.authorization, undefined, 'Authorization must never be logged');
    assert.equal(loggedPayload.cookie, undefined, 'Cookie must never be logged');
    assert.equal(loggedPayload.req, undefined, 'Nested raw request object must not be logged');
    assert.equal(loggedPayload.res, undefined, 'Nested raw response object must not be logged');
  } finally {
    logger.info = originalInfo;
  }
});

