import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Execute an atomic financial transfer between two accounts.
 *
 * @param {Object} params
 * @param {string} params.userId - Authenticated user's ID
 * @param {string} [params.senderAccountId] - Optional specific sender account ID owned by userId
 * @param {string} params.receiverAccountId - Destination account ID
 * @param {number} params.amount - Positive transfer amount
 * @param {string} [params.description] - Purpose/memo for the transaction
 * @returns {Promise<Object>} The completed transaction record with balances
 */
export const transferFunds = async ({
  userId,
  senderAccountId,
  receiverAccountId,
  amount,
  description = null,
}) => {
  // 1. Basic input validation
  if (!receiverAccountId || typeof receiverAccountId !== 'string') {
    throw new ApiError(400, 'A valid receiver account ID is required');
  }

  const transferAmount = Number(amount);
  if (isNaN(transferAmount) || transferAmount <= 0) {
    throw new ApiError(400, 'Transfer amount must be a positive number greater than zero');
  }

  // Ensure amount has at most 2 decimal places
  if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
    throw new ApiError(400, 'Transfer amount can have at most 2 decimal places');
  }

  const client = await pool.connect();

  try {
    // 2. Begin database transaction
    await client.query('BEGIN');

    // 3. Resolve the sender account belonging to authenticated user
    let senderQuery = 'SELECT * FROM accounts WHERE user_id = $1 AND status = $2';
    const senderParams = [userId, 'active'];

    if (senderAccountId) {
      senderQuery += ' AND id = $3';
      senderParams.push(senderAccountId);
    } else {
      senderQuery += ' ORDER BY created_at ASC LIMIT 1';
    }

    const senderLookup = await client.query(senderQuery, senderParams);
    if (senderLookup.rows.length === 0) {
      throw new ApiError(
        404,
        senderAccountId
          ? 'Specified sender account not found or does not belong to you'
          : 'No active account found for current user'
      );
    }

    const resolvedSenderId = senderLookup.rows[0].id;

    // 4. Validate sender and receiver are distinct
    if (resolvedSenderId === receiverAccountId) {
      throw new ApiError(400, 'Sender and receiver accounts cannot be the same');
    }

    // 5. Deadlock-free row-level locking:
    // Lock both accounts in deterministic lexicographical order of their UUIDs
    const [firstId, secondId] = [resolvedSenderId, receiverAccountId].sort();

    const lockedAccountsResult = await client.query(
      `SELECT id, user_id, balance, currency, status 
       FROM accounts 
       WHERE id IN ($1, $2) 
       ORDER BY id 
       FOR UPDATE`,
      [firstId, secondId]
    );

    const lockedAccounts = lockedAccountsResult.rows;
    const senderAccount = lockedAccounts.find((acc) => acc.id === resolvedSenderId);
    const receiverAccount = lockedAccounts.find((acc) => acc.id === receiverAccountId);

    if (!senderAccount) {
      throw new ApiError(404, 'Sender account not found');
    }

    if (senderAccount.user_id !== userId) {
      throw new ApiError(403, 'Unauthorized: You do not own this account');
    }

    if (senderAccount.status !== 'active') {
      throw new ApiError(400, 'Sender account is not active');
    }

    if (!receiverAccount) {
      throw new ApiError(404, 'Receiver account not found');
    }

    if (receiverAccount.status !== 'active') {
      throw new ApiError(400, 'Receiver account is not active');
    }

    // 6. Balance verification under row lock
    const currentSenderBalance = parseFloat(senderAccount.balance);
    if (currentSenderBalance < transferAmount) {
      throw new ApiError(
        400,
        `Insufficient balance. Available: ₹${currentSenderBalance.toFixed(2)}, Requested: ₹${transferAmount.toFixed(2)}`
      );
    }

    // 7. Debit sender account
    const debitResult = await client.query(
      `UPDATE accounts 
       SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, balance`,
      [transferAmount, resolvedSenderId]
    );

    // 8. Credit receiver account
    const creditResult = await client.query(
      `UPDATE accounts 
       SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, balance`,
      [transferAmount, receiverAccountId]
    );

    // 9. Insert transaction record into ledger
    const transactionInsert = await client.query(
      `INSERT INTO transactions (
         sender_account_id,
         receiver_account_id,
         amount,
         currency,
         status,
         description
       ) VALUES ($1, $2, $3, $4, 'completed', $5)
       RETURNING *`,
      [
        resolvedSenderId,
        receiverAccountId,
        transferAmount,
        senderAccount.currency || 'INR',
        description ? description.trim() : null,
      ]
    );

    // 10. Commit the transaction to disk
    await client.query('COMMIT');

    return {
      transaction: transactionInsert.rows[0],
      sender: {
        accountId: resolvedSenderId,
        newBalance: parseFloat(debitResult.rows[0].balance),
      },
      receiver: {
        accountId: receiverAccountId,
        newBalance: parseFloat(creditResult.rows[0].balance),
      },
    };
  } catch (error) {
    // 11. Roll back all tentative updates if anything failed
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error during transaction rollback:', rollbackError);
    }
    throw error;
  } finally {
    // 12. Always release the connection back to the pool
    client.release();
  }
};

/**
 * Retrieve paginated transaction history for the authenticated user
 *
 * @param {Object} params
 * @param {string} params.userId - Authenticated user's ID
 * @param {number} [params.page=1] - Page number (1-based)
 * @param {number} [params.limit=10] - Number of records per page
 * @param {string} [params.accountId] - Optional specific account filter
 * @returns {Promise<Object>} Object containing transactions array and pagination metadata
 */
export const getTransactionHistory = async ({
  userId,
  page = 1,
  limit = 10,
  accountId = null,
}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  let countQuery = `
    SELECT COUNT(*) AS total
    FROM transactions t
    JOIN accounts s_acc ON t.sender_account_id = s_acc.id
    JOIN accounts r_acc ON t.receiver_account_id = r_acc.id
    WHERE (s_acc.user_id = $1 OR r_acc.user_id = $1)
  `;
  const countParams = [userId];

  let dataQuery = `
    SELECT 
      t.id,
      t.sender_account_id,
      t.receiver_account_id,
      t.amount,
      t.currency,
      t.status,
      t.description,
      t.created_at,
      t.updated_at,
      s_acc.account_type AS sender_account_type,
      s_user.name AS sender_name,
      s_user.email AS sender_email,
      r_acc.account_type AS receiver_account_type,
      r_user.name AS receiver_name,
      r_user.email AS receiver_email,
      CASE WHEN s_acc.user_id = $1 THEN 'debit' ELSE 'credit' END AS direction
    FROM transactions t
    JOIN accounts s_acc ON t.sender_account_id = s_acc.id
    JOIN users s_user ON s_acc.user_id = s_user.id
    JOIN accounts r_acc ON t.receiver_account_id = r_acc.id
    JOIN users r_user ON r_acc.user_id = r_user.id
    WHERE (s_acc.user_id = $1 OR r_acc.user_id = $1)
  `;
  const dataParams = [userId];

  if (accountId) {
    countQuery += ` AND (t.sender_account_id = $2 OR t.receiver_account_id = $2)`;
    countParams.push(accountId);

    dataQuery += ` AND (t.sender_account_id = $2 OR t.receiver_account_id = $2)`;
    dataParams.push(accountId);
  }

  // Count total matching records
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total, 10);

  // Fetch paginated records sorted by created_at DESC
  const limitIndex = dataParams.length + 1;
  const offsetIndex = dataParams.length + 2;
  dataQuery += ` ORDER BY t.created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
  dataParams.push(limitNum, offset);

  const transactionsResult = await pool.query(dataQuery, dataParams);
  const totalPages = Math.ceil(total / limitNum) || 1;

  return {
    transactions: transactionsResult.rows,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
  };
};

/**
 * Retrieve transaction details by ID with strict ownership authorization
 *
 * @param {Object} params
 * @param {string} params.userId - Authenticated user's ID
 * @param {string} params.transactionId - Transaction UUID
 * @returns {Promise<Object>} Formatted transaction object
 */
export const getTransactionById = async ({ userId, transactionId }) => {
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!transactionId || !uuidRegex.test(transactionId)) {
    throw new ApiError(400, 'Invalid transaction ID format');
  }

  const query = `
    SELECT 
      t.id,
      t.sender_account_id,
      t.receiver_account_id,
      t.amount,
      t.currency,
      t.status,
      t.description,
      t.created_at,
      t.updated_at,
      s_acc.user_id AS sender_user_id,
      s_acc.account_type AS sender_account_type,
      s_user.name AS sender_name,
      s_user.email AS sender_email,
      r_acc.user_id AS receiver_user_id,
      r_acc.account_type AS receiver_account_type,
      r_user.name AS receiver_name,
      r_user.email AS receiver_email
    FROM transactions t
    JOIN accounts s_acc ON t.sender_account_id = s_acc.id
    JOIN users s_user ON s_acc.user_id = s_user.id
    JOIN accounts r_acc ON t.receiver_account_id = r_acc.id
    JOIN users r_user ON r_acc.user_id = r_user.id
    WHERE t.id = $1
  `;

  const result = await pool.query(query, [transactionId]);

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Transaction not found');
  }

  const row = result.rows[0];

  // Authorization check: Is the authenticated user either the sender or receiver?
  const isSender = row.sender_user_id === userId;
  const isReceiver = row.receiver_user_id === userId;

  if (!isSender && !isReceiver) {
    throw new ApiError(403, 'Access denied: You are not authorized to view this transaction');
  }

  return {
    id: row.id,
    sender_account_id: row.sender_account_id,
    receiver_account_id: row.receiver_account_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sender: {
      accountId: row.sender_account_id,
      name: row.sender_name,
      email: row.sender_email,
      accountType: row.sender_account_type,
    },
    receiver: {
      accountId: row.receiver_account_id,
      name: row.receiver_name,
      email: row.receiver_email,
      accountType: row.receiver_account_type,
    },
    direction: isSender ? 'debit' : 'credit',
  };
};
