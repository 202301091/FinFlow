import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { ApiError } from './utils/ApiError.js';
import { ApiResponse } from './utils/ApiResponse.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';
import { httpLogger } from './config/logger.js';
import { pool } from './config/db.js';
import { isRedisAvailable } from './config/redis.js';
import { register, metricsMiddleware } from './config/metrics.js';

// Route imports
import userRouter from './routes/user.routes.js';
import accountRouter from './routes/account.routes.js';
import transactionRouter from './routes/transaction.routes.js';
import notificationRouter from './routes/notification.routes.js';
import fraudRouter from './routes/fraud.routes.js';

const app = express();

// Trust reverse proxy / load balancer headers for client IP extraction in multi-instance deployments
app.set('trust proxy', true);

// Attach Request ID middleware early for all requests and logging
app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(metricsMiddleware);

const rawCors = process.env.CORS_ORIGIN || 'http://localhost:3000';
const allowedOrigins = rawCors.split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
    },
    credentials: true,
}));

app.use(express.json({ limit: '20kb' })); // Use for parsing JSON bodies
app.use(express.urlencoded({ extended: true, limit: '20kb' })); // Use for parsing URL-encoded bodies
app.use(express.static('public')); // Serve static files from the 'public' directory
app.use(cookieParser()); // Use for parsing cookies

// Liveness probe (shallow, fast, no DB call)
app.get(['/health', '/health/live'], (req, res) => {
    return res.status(200).json(
        new ApiResponse(200, { status: 'UP', uptime: process.uptime() }, 'Service is live')
    );
});

// Readiness probe (deep check: verifies PostgreSQL and Redis availability)
app.get('/health/ready', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        const redisReady = isRedisAvailable();

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    status: 'READY',
                    checks: {
                        database: 'UP',
                        redis: redisReady ? 'UP' : 'DEGRADED',
                    },
                },
                'Instance is ready to serve traffic'
            )
        );
    } catch (error) {
        return res.status(503).json(
            new ApiError(503, 'Instance not ready: database connection unavailable')
        );
    }
});

app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (error) {
        res.status(500).send(`Error collecting metrics: ${error.message}`);
    }
});

// API Routes
app.use('/api/v1/users', userRouter);
app.use('/api/v1/accounts', accountRouter);
app.use('/api/v1/transactions', transactionRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/fraud', fraudRouter);

// Global error handling middleware (must be after routes)
app.use(errorHandler);

export default app;