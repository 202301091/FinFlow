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
    if (!receiverAccountId) {
      throw new ApiError(400, 'Receiver account ID (receiverAccountId) is required');
    }

    if (amount === undefined || amount === null) {
      throw new ApiError(400, 'Transfer amount is required');
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new ApiError(400, 'Amount must be a positive number greater than zero');
    }

    // Compute deterministic request hash
    const requestPayload = {
      senderAccountId: senderAccountId || null,
      receiverAccountId,
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
        senderAccountId,
        receiverAccountId,
        amount: numericAmount,
        description,
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

    const { page = 1, limit = 10, accountId } = req.query;

    const result = await getTransactionHistory({
      userId,
      page,
      limit,
      accountId,
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

    const transaction = await getTransactionById({
      userId,
      transactionId: id,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, transaction, 'Transaction details retrieved successfully'));
  } catch (error) {
    next(error);
  }
};
