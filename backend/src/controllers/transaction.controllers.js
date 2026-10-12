import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import {
  transferFunds,
  getTransactionHistory,
  getTransactionById,
} from '../services/transaction.service.js';
import {
  computeRequestHash,
  checkOrCreateIdempotencyKey,
  markIdempotencyCompleted,
  markIdempotencyFailed,
} from '../services/idempotency.service.js';
import { createAuditLog } from '../services/audit.service.js';
import { getCache, setCache } from '../utils/redis.util.js';

/**
 * Handle money transfer between accounts
 * POST /api/v1/transactions/transfer
 * Requires Idempotency-Key header
 */
export const transferMoney = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

    // Extract Idempotency-Key from headers (or fallback to body if provided)
    const idempotencyKey =
      req.header('idempotency-key') ||
      req.header('Idempotency-Key') ||
      req.headers['idempotency-key'] ||
      req.body?.idempotency_key;

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new ApiError(400, 'Idempotency-Key header is required for transfer requests');
    }

    const trimmedKey = idempotencyKey.trim();
    const { receiverAccountId, amount, description, senderAccountId } = req.body;

    // Validate presence of required fields
    if (!receiverAccountId || typeof receiverAccountId !== 'string' || !receiverAccountId.trim()) {
      throw new ApiError(400, 'Receiver account ID (receiverAccountId) is required');
    }

    if (amount === undefined || amount === null) {
      throw new ApiError(400, 'Transfer amount is required');
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new ApiError(400, 'Amount must be a positive number greater than zero');
    }

    if (!senderAccountId || typeof senderAccountId !== 'string' || !senderAccountId.trim()) {
      throw new ApiError(400, 'Sender account ID (senderAccountId) is required');
    }

    const trimmedSenderId = senderAccountId.trim();
    const trimmedReceiverId = receiverAccountId.trim();

    if (trimmedSenderId === trimmedReceiverId) {
      throw new ApiError(400, 'Sender and receiver accounts cannot be the same');
    }

    const transactionPin =
      req.body?.transactionPin ||
      req.body?.pin ||
      req.header('x-transaction-pin') ||
      req.header('X-Transaction-PIN');

    // Verify 6-digit Transaction PIN if configured on user's account
    const userResult = await pool.query('SELECT transaction_pin_hash FROM users WHERE id = $1', [userId]);
    const dbUser = userResult.rows[0];

    if (dbUser?.transaction_pin_hash) {
      if (!transactionPin || typeof transactionPin !== 'string' || !/^\d{6}$/.test(String(transactionPin).trim())) {
        throw new ApiError(400, 'A valid 6-digit Transaction PIN is required to authorize this transfer');
      }

      const isPinValid = await bcrypt.compare(String(transactionPin).trim(), dbUser.transaction_pin_hash);
      if (!isPinValid) {
        await createAuditLog({
          userId,
          action: 'TRANSFER_PIN_FAILED',
          resourceType: 'transaction',
          resourceId: null,
          requestId: req.id,
          status: 'FAILURE',
          metadata: { senderAccountId: trimmedSenderId, reason: 'Incorrect transaction PIN' },
        });
        throw new ApiError(401, 'Invalid transaction PIN. Transfer authorization failed');
      }
    } else if (transactionPin) {
      throw new ApiError(400, 'Transaction PIN is not configured on this account. Please set a 6-digit PIN in settings first');
    } else if (process.env.ENFORCE_PIN === 'true') {
      throw new ApiError(403, 'Transaction PIN has not been configured. Please set your 6-digit PIN before making transfers');
    }

    // Compute deterministic request hash
    const requestPayload = {
      senderAccountId: trimmedSenderId,
      receiverAccountId: trimmedReceiverId,
      amount: numericAmount,
      description: description ? description.trim() : null,
    };
    const requestHash = computeRequestHash(requestPayload);

    // Coordinate with idempotency record
    const idempotency = await checkOrCreateIdempotencyKey({
      key: trimmedKey,
      userId,
      requestPath: req.baseUrl ? `${req.baseUrl}/transfer` : '/api/v1/transactions/transfer',
      requestHash,
    });

    // If already completed with identical payload, replay cached response
    if (idempotency.isReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      return res.status(idempotency.responseStatus || 200).json(idempotency.responseBody);
    }

    try {
      // Execute atomic transfer via transaction service
      const result = await transferFunds({
        userId,
        senderAccountId: trimmedSenderId,
        receiverAccountId: trimmedReceiverId,
        amount: numericAmount,
        description,
        requestId: req.id,
      });

      const responsePayload = new ApiResponse(200, result, 'Transfer completed successfully');

      // Persist successful response in idempotency_keys
      await markIdempotencyCompleted({
        key: trimmedKey,
        userId,
        statusCode: 200,
        responseBody: responsePayload,
      });

      // Record immutable audit log for completed transfer
      await createAuditLog({
        userId,
        action: 'TRANSFER_COMPLETED',
        resourceType: 'transaction',
        resourceId: result.transaction.id,
        requestId: req.id,
        status: 'SUCCESS',
        metadata: {
          amount: numericAmount,
          senderAccountId: result.sender.accountId,
          receiverAccountId: result.receiver.accountId,
          senderNewBalance: result.sender.newBalance,
          description: description ? description.trim() : null,
        },
      });


      return res.status(200).json(responsePayload);
    } catch (transferError) {
      // Mark key failed so future attempts or retries can be processed cleanly
      await markIdempotencyFailed({ key: trimmedKey, userId });

      // Record audit log for failed transfer attempt
      await createAuditLog({
        userId,
        action: 'TRANSFER_FAILED',
        resourceType: 'transaction',
        resourceId: null,
        requestId: req.id,
        status: 'FAILURE',
        metadata: {
          amount: numericAmount,
          senderAccountId: senderAccountId || null,
          receiverAccountId,
          errorMessage: transferError.message,
        },
      });

      throw transferError;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get paginated transaction history for the logged-in user
 * GET /api/v1/transactions
 */
export const getAllTransactions = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

    const { page, limit = 10, accountId, cursor } = req.query;

    const result = await getTransactionHistory({
      userId,
      page: page ? parseInt(page, 10) : (cursor ? null : 1),
      limit,
      accountId,
      cursor,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, 'Transactions retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get transaction details by ID (sender or receiver only)
 * GET /api/v1/transactions/:id
 */
export const getTransactionDetails = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

    const { id } = req.params;

    // Get transaction from cache if available
    const cacheKey = `transaction:${userId}:${id}`;
    const cachedTransaction = await getCache(cacheKey);

    if (cachedTransaction) {
      return res
        .status(200)
        .json(new ApiResponse(200, cachedTransaction, 'Transaction details retrieved successfully (from cache)'));
    }

    const transaction = await getTransactionById({
      userId,
      transactionId: id,
    });

    // Cache the transaction details for future requests (5 minutes)
    await setCache(cacheKey, transaction, 300);

    return res
      .status(200)
      .json(new ApiResponse(200, transaction, 'Transaction details retrieved successfully'));
  } catch (error) {
    next(error);
  }
};
