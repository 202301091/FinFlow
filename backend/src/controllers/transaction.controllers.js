import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import {
  transferFunds,
  getTransactionHistory,
  getTransactionById,
} from '../services/transaction.service.js';

/**
 * Handle money transfer between accounts
 * POST /api/v1/transactions/transfer
 */
export const transferMoney = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

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

    // Execute atomic transfer via transaction service
    const result = await transferFunds({
      userId,
      senderAccountId,
      receiverAccountId,
      amount: numericAmount,
      description,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, 'Transfer completed successfully'));
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
