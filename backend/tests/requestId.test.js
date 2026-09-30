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

test('Request ID: Generates a new UUID v4 when X-Request-ID header is missing', async () => {
  const res = await fetch(`${baseUrl}/health`);
  const requestId = res.headers.get('x-request-id');

  assert.ok(requestId, 'Response must include X-Request-ID header');
  // Check UUID format
  assert.match(
    requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Generated request ID must be a valid UUID'
  );
});

test('Request ID: Preserves incoming X-Request-ID header', async () => {
  const customId = 'client-trace-id-abc123xyz';
  const res = await fetch(`${baseUrl}/health`, {
    headers: {
      'X-Request-ID': customId,
    },
  });

  const responseId = res.headers.get('x-request-id');
  assert.equal(responseId, customId, 'Response header must match the custom X-Request-ID provided');
});

test('Request ID: Different requests without header receive distinct IDs', async () => {
  const res1 = await fetch(`${baseUrl}/health`);
  const res2 = await fetch(`${baseUrl}/health`);

  const id1 = res1.headers.get('x-request-id');
  const id2 = res2.headers.get('x-request-id');

  assert.ok(id1);
  assert.ok(id2);
  assert.notEqual(id1, id2, 'Successive requests must receive distinct Request IDs');
});
