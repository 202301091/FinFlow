import http from 'node:http';
import logger from './config/logger.js';

/**
 * FinFlow Simple Local Load Balancer & Reverse Proxy
 * Demonstrates Client -> Load Balancer (Port 5000) -> API Instances (5001, 5002, ...)
 *
 * Simulates what Render / AWS ALB does in production:
 * 1. Round-robin request distribution across healthy backend targets.
 * 2. Injects proxy headers (x-forwarded-for, x-forwarded-proto, x-forwarded-host).
 * 3. Graceful handling and connection draining.
 */

const LB_PORT = parseInt(process.env.LB_PORT || '5000', 10);
const TARGETS = (process.env.TARGETS || 'http://127.0.0.1:5001,http://127.0.0.1:5002')
  .split(',')
  .map((t) => t.trim().replace(/\/+$/, ''));

let currentTargetIndex = 0;

export const getNextTarget = () => {
  const target = TARGETS[currentTargetIndex % TARGETS.length];
  currentTargetIndex = (currentTargetIndex + 1) % TARGETS.length;
  return target;
};

export const createLoadBalancerServer = (targets = TARGETS) => {
  return http.createServer((clientReq, clientRes) => {
    // 1. Pick target using round-robin
    const targetUrl = new URL(getNextTarget());

    // 2. Prepare headers with standard proxy forwarding attributes
    const clientIp = clientReq.socket.remoteAddress || '127.0.0.1';
    const existingForwarded = clientReq.headers['x-forwarded-for'];
    const forwardedFor = existingForwarded ? `${existingForwarded}, ${clientIp}` : clientIp;

    const proxyHeaders = {
      ...clientReq.headers,
      host: targetUrl.host,
      'x-forwarded-for': forwardedFor,
      'x-forwarded-proto': clientReq.socket.encrypted ? 'https' : 'http',
      'x-forwarded-host': clientReq.headers.host || targetUrl.host,
      'x-forwarded-port': String(LB_PORT),
    };

    const proxyOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: clientReq.url,
      method: clientReq.method,
      headers: proxyHeaders,
    };

    // 3. Forward request to selected backend instance
    const proxyReq = http.request(proxyOptions, (proxyRes) => {
      // Inject header so client can observe which node served the request (useful for testing/demo)
      const responseHeaders = { ...proxyRes.headers, 'x-served-by': targetUrl.port };
      clientRes.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on('error', (err) => {
      logger.error({ err }, `[Load Balancer] Proxy error connecting to ${targetUrl.origin}: ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({
          statusCode: 502,
          success: false,
          message: 'Bad Gateway: Backend instance unavailable',
          target: targetUrl.origin,
        }));
      }
    });

    clientReq.pipe(proxyReq, { end: true });
  });
};

// Start standalone server when executed directly
if (process.argv[1] && process.argv[1].endsWith('load-balancer.js')) {
  const server = createLoadBalancerServer();
  server.listen(LB_PORT, () => {
    logger.info(`[Load Balancer] Listening on port ${LB_PORT}`);
    logger.info(`[Load Balancer] Distributing traffic across: ${TARGETS.join(', ')}`);
  });

  const shutdown = () => {
    logger.info('[Load Balancer] Shutting down gracefully...');
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    server.close(() => {
      logger.info('[Load Balancer] Closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('message', (msg) => {
    if (msg === 'shutdown' || msg?.action === 'shutdown') shutdown();
  });
}
