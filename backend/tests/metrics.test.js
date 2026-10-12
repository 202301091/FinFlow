import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import app from '../src/app.js';
import { register } from '../src/config/metrics.js';

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

test('Prometheus Metrics: GET /metrics exposes standard Prometheus format', async () => {
  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/i);
  assert.ok(text.includes('# HELP'), 'Metrics output must include HELP comments');
  assert.ok(text.includes('# TYPE'), 'Metrics output must include TYPE comments');
});

test('Prometheus Metrics: Total HTTP requests (http_requests_total) increments with labels', async () => {
  await fetch(`${baseUrl}/health`);

  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.ok(text.includes('http_requests_total'), 'Must include http_requests_total counter');
  assert.match(
    text,
    /http_requests_total\{method="GET",route="\/health",status="200"\} [1-9]\d*/,
    'Must record count for GET /health with status 200'
  );
});

test('Prometheus Metrics: HTTP request duration (http_request_duration_seconds) histogram records observations', async () => {
  await fetch(`${baseUrl}/health`);

  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.ok(text.includes('http_request_duration_seconds_bucket'), 'Must include duration histogram buckets');
  assert.ok(text.includes('http_request_duration_seconds_count'), 'Must include duration observation count');
});

test('Prometheus Metrics: HTTP errors (http_errors_total) tracks failed requests with normalized 404 route', async () => {
  // Trigger a 404 error
  await fetch(`${baseUrl}/api/v1/invalid-route-for-testing-404`);

  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.ok(text.includes('http_errors_total'), 'Must include http_errors_total metric');
  assert.match(
    text,
    /http_errors_total\{method="GET",route="not_found",status="404"\} [1-9]\d*/,
    'Must record failed request in http_errors_total with route="not_found"'
  );
});

test('Prometheus Metrics: Active requests (http_active_requests) tracks in-flight gauge', async () => {
  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.ok(text.includes('http_active_requests'), 'Must include http_active_requests metric');
  assert.match(text, /http_active_requests\{method="GET"\} \d+/, 'Must expose active requests gauge');
});

test('Prometheus Metrics: Process memory (process_memory_bytes) monitors memory usage', async () => {
  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.ok(text.includes('process_memory_bytes'), 'Must include process_memory_bytes metric');
  assert.ok(text.includes('process_memory_bytes{type="heapUsed"}'), 'Must monitor heapUsed memory');
  assert.ok(text.includes('process_memory_bytes{type="rss"}'), 'Must monitor RSS memory');
});

test('Prometheus Metrics: Process uptime (process_uptime_seconds) tracks running duration', async () => {
  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.ok(text.includes('process_uptime_seconds'), 'Must include process_uptime_seconds metric');
  assert.match(text, /process_uptime_seconds \d+(\.\d+)?/, 'Must record valid process uptime');
});

test('Prometheus Metrics: Normalizes high-cardinality parameterized UUID paths', async () => {
  const sampleUuid = '123e4567-e89b-12d3-a456-426614174000';
  await fetch(`${baseUrl}/api/v1/transactions/${sampleUuid}`);

  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.doesNotMatch(
    text,
    new RegExp(sampleUuid),
    'Metrics label must NOT contain raw UUID to prevent cardinality explosion'
  );
});

test('Prometheus Metrics: Unmatched 404 routes do not create arbitrary metric labels', async () => {
  const scannerPath = 'malicious-probe-' + Date.now();
  await fetch(`${baseUrl}/${scannerPath}`);

  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.doesNotMatch(
    text,
    new RegExp(scannerPath),
    'Arbitrary 404 path must not leak into metrics labels'
  );
  assert.match(
    text,
    /http_requests_total\{method="GET",route="not_found",status="404"\}/,
    'Unmatched 404 must be labeled route="not_found"'
  );
});

test('Prometheus Metrics: Active requests gauge returns to zero after requests settle', async () => {
  // Fire multiple parallel requests
  await Promise.all([
    fetch(`${baseUrl}/health`),
    fetch(`${baseUrl}/health/live`),
    fetch(`${baseUrl}/api/v1/invalid-probe`),
  ]);

  const res = await fetch(`${baseUrl}/metrics`);
  const text = await res.text();

  assert.ok(text.includes('http_active_requests'), 'Must include active requests metric');
  assert.match(
    text,
    /http_active_requests\{method="GET"\} [0-1]/,
    'Active requests gauge must decrement to 0 (or at most 1 for the /metrics scrape itself)'
  );
});



