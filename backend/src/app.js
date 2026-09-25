import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { ApiError } from './utils/ApiError.js';
import { ApiResponse } from './utils/ApiResponse.js';

// Route imports
import userRouter from './routes/user.routes.js';
import accountRouter from './routes/account.routes.js';

const app = express();

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

// Global error handling middleware (must be after routes)
app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json(err);
    }
    return res.status(500).json(
        new ApiError(500, err?.message || 'Internal Server Error')
    );
});

export default app;