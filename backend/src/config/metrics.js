import client from 'prom-client';

const register = new client.Registry();

// Enable collection of default Node.js and process metrics
client.collectDefaultMetrics({ register });

// 1. Total HTTP requests - Understand API traffic
const httpRequest = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests (Understand API traffic)',
  labelNames: ['method', 'route', 'status'],
});
register.registerMetric(httpRequest);

// 2. HTTP request duration - Identify slow endpoints
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds (Identify slow endpoints)',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
register.registerMetric(httpRequestDuration);

// 3. HTTP errors - Track failed requests
const httpErrors = new client.Counter({
  name: 'http_errors_total',
  help: 'Total number of failed HTTP requests (Track failed requests)',
  labelNames: ['method', 'route', 'status'],
});
register.registerMetric(httpErrors);

// 4. Active requests - Understand current server load
const httpActiveRequests = new client.Gauge({
  name: 'http_active_requests',
  help: 'Number of currently active in-flight HTTP requests (Understand current server load)',
  labelNames: ['method'],
});
register.registerMetric(httpActiveRequests);

// 5. Process memory - Monitor memory usage
const processMemory = new client.Gauge({
  name: 'process_memory_bytes',
  help: 'Process memory usage in bytes (Monitor memory usage)',
  labelNames: ['type'],
  collect() {
    const mem = process.memoryUsage();
    this.set({ type: 'heapTotal' }, mem.heapTotal);
    this.set({ type: 'heapUsed' }, mem.heapUsed);
    this.set({ type: 'rss' }, mem.rss);
    this.set({ type: 'external' }, mem.external);
  },
});
register.registerMetric(processMemory);

// 6. Process uptime - Track how long the process has been running
const processUptime = new client.Gauge({
  name: 'process_uptime_seconds',
  help: 'Process uptime in seconds (Track how long the process has been running)',
  collect() {
    this.set(process.uptime());
  },
});
register.registerMetric(processUptime);

// Financial transactions & fraud surveillance metrics
const transactionsTotal = new client.Counter({
  name: 'finflow_transactions_total',
  help: 'Total number of financial transactions processed',
  labelNames: ['status'],
});
register.registerMetric(transactionsTotal);

const transactionAmountTotal = new client.Counter({
  name: 'finflow_transaction_amount_total',
  help: 'Total monetary volume of transactions processed',
  labelNames: ['currency'],
});
register.registerMetric(transactionAmountTotal);

const fraudAlertsTotal = new client.Counter({
  name: 'finflow_fraud_alerts_total',
  help: 'Total number of fraud alerts triggered',
  labelNames: ['severity'],
});
register.registerMetric(fraudAlertsTotal);

/**
 * Express middleware to collect HTTP metrics on every incoming request.
 * Matches the route normalization and timing used in logger.js.
 */
export const metricsMiddleware = (req, res, next) => {
  // Do not record metrics collection requests themselves to avoid skewing data
  if (req.path === '/metrics') {
    return next();
  }

  const start = process.hrtime();
  httpActiveRequests.inc({ method: req.method });

  let finalized = false;

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    httpActiveRequests.dec({ method: req.method });

    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;

    let rawRoute = req.route?.path;
    if (Array.isArray(rawRoute)) {
      rawRoute = rawRoute.find((p) => req.path.endsWith(p)) || rawRoute[0];
    } else if (typeof rawRoute === 'string' && rawRoute.includes(',')) {
      const parts = rawRoute.split(',');
      rawRoute = parts.find((p) => req.path.endsWith(p)) || parts[0];
    }

    let route;
    if (req.route && rawRoute) {
      route = (req.baseUrl || '') + rawRoute;
      // Normalize UUIDs and numeric IDs to avoid high-cardinality series explosion
      route = route
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':id')
        .replace(/\/\d+/g, '/:id');
    } else if (res.statusCode === 404) {
      route = 'not_found';
    } else {
      route = req.baseUrl ? `${req.baseUrl}/unmatched` : 'unmatched';
    }

    const statusCode = res.statusCode || (res.writableEnded ? 200 : 499);
    const status = statusCode ? String(statusCode) : 'unknown';

    // 1. Total HTTP requests
    httpRequest.inc({
      method: req.method,
      route,
      status,
    });

    // 2. HTTP request duration
    httpRequestDuration.observe(
      {
        method: req.method,
        route,
        status,
      },
      durationInSeconds
    );

    // 3. HTTP errors (status >= 400)
    if (statusCode >= 400) {
      httpErrors.inc({
        method: req.method,
        route,
        status,
      });
    }
  };

  res.on('finish', finalize);
  res.on('close', finalize);

  next();
};

export {
  client,
  register,
  httpRequest,
  httpRequestDuration,
  httpErrors,
  httpActiveRequests,
  processMemory,
  processUptime,
  transactionsTotal,
  transactionAmountTotal,
  fraudAlertsTotal,
};
export default register;