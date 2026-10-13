import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { createAuditLog } from '../services/audit.service.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import logger from '../config/logger.js';

/**
 * Create a new account for the authenticated user
 * POST /api/v1/accounts
 */
const createAccount = async (req, res) => {
    const { account_type, balance } = req.body;
    const user_id = req.user?.id;

    if (!user_id) {
        return res.status(401).json(new ApiError(401, "User authentication required"));
    }

    if (!account_type) {
        return res.status(400).json(new ApiError(400, "Account type is required"));
    }

    const initialBalance = balance !== undefined && balance !== null ? parseFloat(balance) : 0.00;
    if (isNaN(initialBalance) || initialBalance < 0) {
        return res.status(400).json(new ApiError(400, "Balance must be a valid non-negative number"));
    }

    const normalizedType = account_type.trim().toLowerCase();

    try {
        const existingAccount = await pool.query(
            'SELECT id FROM accounts WHERE user_id = $1 AND account_type = $2',
            [user_id, normalizedType]
        );

        if (existingAccount.rows.length > 0) {
            await createAuditLog({
                userId: user_id,
                action: 'ACCOUNT_CREATION_FAILED',
                resourceType: 'account',
                resourceId: null,
                requestId: req.id,
                status: 'FAILURE',
                metadata: { accountType: normalizedType, reason: `User already has a ${normalizedType} account` },
            });
            return res.status(409).json(new ApiError(409, `User already has a ${normalizedType} account`));
        }

        const newAccount = await pool.query(
            'INSERT INTO accounts (user_id, account_type, balance) VALUES ($1, $2, $3) RETURNING id, user_id, account_type, balance, currency, status, created_at',
            [user_id, normalizedType, initialBalance]
        );

        const createdAccount = newAccount.rows[0];

        await createAuditLog({
            userId: user_id,
            action: 'ACCOUNT_CREATED',
            resourceType: 'account',
            resourceId: createdAccount.id,
            requestId: req.id,
            status: 'SUCCESS',
            metadata: {
                accountType: createdAccount.account_type,
                initialBalance: parseFloat(createdAccount.balance),
                currency: createdAccount.currency,
            },
        });

        await deleteCache(
            `accounts:${user_id}:${normalizedType}`,
            `accounts:${user_id}:all`
        );

        return res.status(201).json(new ApiResponse(201, createdAccount, "Account created successfully"));
    } catch (error) {
        logger.error({ err: error }, `Error creating account: ${error.message || error}`);
        return res.status(500).json(new ApiError(500, error?.message || "Internal server error"));
    }
};

/**
 * Fetch accounts belonging to the authenticated user with caching
 * GET /api/v1/accounts
 */
const getAccounts = async (req, res) => {
    const user_id = req.user?.id;
    const { account_type } = req.query;

    if (!user_id) {
        return res.status(401).json(new ApiError(401, "User authentication required"));
    }

    try {
        const normalizedType = account_type ? account_type.trim().toLowerCase() : null;
        const cacheKey = normalizedType
            ? `accounts:${user_id}:${normalizedType}`
            : `accounts:${user_id}:all`;

        const cachedAccounts = await getCache(cacheKey);

        if (cachedAccounts) {
            return res.status(200).json(
                new ApiResponse(200, cachedAccounts, "Accounts fetched successfully (from cache)")
            );
        }

        let query = 'SELECT id, account_type, balance, currency, status, created_at FROM accounts WHERE user_id = $1';
        const params = [user_id];

        if (normalizedType) {
            query += ' AND account_type = $2';
            params.push(normalizedType);
        }

        query += ' ORDER BY created_at DESC';

        const accounts = await pool.query(query, params);

        await setCache(cacheKey, accounts.rows, 60);

        return res.status(200).json(new ApiResponse(200, accounts.rows, "Accounts fetched successfully"));
    } catch (error) {
        logger.error({ err: error }, `Error fetching accounts: ${error.message || error}`);
        return res.status(500).json(new ApiError(500, error?.message || "Internal server error"));
    }
};

export { createAccount, getAccounts };