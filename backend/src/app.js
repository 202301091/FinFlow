import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { ApiError } from './utils/ApiError.js';
import { ApiResponse } from './utils/ApiResponse.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

// Route imports
import userRouter from './routes/user.routes.js';
import accountRouter from './routes/account.routes.js';
import transactionRouter from './routes/transaction.routes.js';
import notificationRouter from './routes/notification.routes.js';
import fraudRouter from './routes/fraud.routes.js';

const app = express();

// Attach Request ID middleware early for all requests and logging
app.use(requestIdMiddleware);

app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
}));

app.use(express.json({ limit: '20kb' })); // Use for parsing JSON bodies
app.use(express.urlencoded({ extended: true, limit: '20kb' })); // Use for parsing URL-encoded bodies
app.use(express.static('public')); // Serve static files from the 'public' directory
app.use(cookieParser()); // Use for parsing cookies

// Health check endpoint
app.get('/health', (req, res) => {
    return res.status(200).json(
        new ApiResponse(200, { status: 'OK', uptime: process.uptime() }, 'Server is healthy')
    );
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