import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteCache } from '../utils/redis.util.js';
import { createTransactionCompletedEvent } from '../events/transaction.event.js';
import { writeOutboxEvent, processPendingOutboxEvents } from './outbox.service.js';
import logger from '../config/logger.js';
import { transactionsTotal, transactionAmountTotal } from '../config/metrics.js';
export const transferFunds = async ({
  userId,
  senderAccountId,
  receiverAccountId,
  amount,
  description = null,
  requestId = null,
}) => {
  if (!senderAccountId || typeof senderAccountId !== 'string' || !senderAccountId.trim()) {
    throw new ApiError(400, 'A valid sender account ID is required');
  }

  if (!receiverAccountId || typeof receiverAccountId !== 'string' || !receiverAccountId.trim()) {
    throw new ApiError(400, 'A valid receiver account ID is required');
  }

  const trimmedSenderId = senderAccountId.trim();
  const trimmedReceiverId = receiverAccountId.trim();

  if (trimmedSenderId === trimmedReceiverId) {
    throw new ApiError(400, 'Sender and receiver accounts cannot be the same');
  }

  const transferAmount = Number(amount);
  if (isNaN(transferAmount) || transferAmount <= 0) {
    throw new ApiError(400, 'Transfer amount must be a positive number greater than zero');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
    throw new ApiError(400, 'Transfer amount can have at most 2 decimal places');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const senderLookup = await client.query(
      'SELECT id, user_id, status FROM accounts WHERE id = $1',
      [trimmedSenderId]
    );

    if (senderLookup.rows.length === 0) {
      throw new ApiError(404, 'Specified sender account not found');
    }

    if (senderLookup.rows[0].user_id !== userId) {
      throw new ApiError(403, 'Unauthorized: You do not own this account');
    }

    if (senderLookup.rows[0].status !== 'active') {
      throw new ApiError(400, 'Sender account is not active');
    }

    const resolvedSenderId = senderLookup.rows[0].id;

    if (resolvedSenderId === trimmedReceiverId) {
      throw new ApiError(400, 'Sender and receiver accounts cannot be the same');
    }

    // Deadlock-free row-level locking: sort UUIDs deterministically
    const [firstId, secondId] = [resolvedSenderId, trimmedReceiverId].sort();

    const lockedAccountsResult = await client.query(
      `SELECT id, user_id, account_type, balance, currency, status 
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

    const currentSenderBalance = parseFloat(senderAccount.balance);
    if (currentSenderBalance < transferAmount) {
      throw new ApiError(
        400,
        `Insufficient balance. Available: ₹${currentSenderBalance.toFixed(2)}, Requested: ₹${transferAmount.toFixed(2)}`
      );
    }

    const debitResult = await client.query(
      `UPDATE accounts 
       SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, balance`,
      [transferAmount, resolvedSenderId]
    );

    const creditResult = await client.query(
      `UPDATE accounts 
       SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, balance`,
      [transferAmount, receiverAccountId]
    );

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

    // Write event to Transactional Outbox within the same atomic boundary
    const completedEvent = createTransactionCompletedEvent({
      transaction: transactionInsert.rows[0],
      senderUserId: userId,
      receiverUserId: receiverAccount.user_id,
      senderAccountId: resolvedSenderId,
      receiverAccountId,
      amount: transferAmount,
      currency: senderAccount.currency || 'INR',
      description,
      requestId,
    });

    await writeOutboxEvent({
      client,
      aggregateId: transactionInsert.rows[0].id,
      eventType: completedEvent.eventType,
      payload: completedEvent,
      partitionKey: resolvedSenderId,
    });

    await client.query('COMMIT');

    await deleteCache(
      `accounts:${userId}:${senderAccount.account_type}`,
      `accounts:${userId}:all`,
      `accounts:${receiverAccount.user_id}:${receiverAccount.account_type}`,
      `accounts:${receiverAccount.user_id}:all`
    );

    // Asynchronously trigger Kafka outbox dispatch without blocking client response.
    // Downstream Kafka consumer workers handle notifications and fraud evaluations.
    processPendingOutboxEvents({ limit: 20 }).catch((outboxErr) => {
      logger.warn({ err: outboxErr }, `[TransferService] Post-commit outbox flush warning: ${outboxErr.message}`);
    });

    try {
      transactionsTotal.inc({ status: 'success' });
      transactionAmountTotal.inc(
        { currency: senderAccount.currency || 'INR' },
        Number(transferAmount)
      );
    } catch {}

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
    try {
      transactionsTotal.inc({ status: 'failed' });
    } catch {}
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, `Error during transaction rollback: ${rollbackError.message || rollbackError}`);
    }
    throw error;
  } finally {
    client.release();
  }
};

export const getTransactionHistory = async ({
  userId,
  page = null,
  limit = 10,
  accountId = null,
  cursor = null,
}) => {
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

  // Base data query
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
    dataQuery += ` AND (t.sender_account_id = $2 OR t.receiver_account_id = $2)`;
    dataParams.push(accountId);
  }

  // Path A: Scalable Keyset / Cursor Pagination (when cursor param is provided or requested)
  if (cursor) {
    let parsedCursor = null;
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      parsedCursor = JSON.parse(decoded);
    } catch {}

    if (parsedCursor?.createdAt && parsedCursor?.id) {
      const dateParamIdx = dataParams.length + 1;
      const idParamIdx = dataParams.length + 2;
      dataQuery += ` AND (t.created_at < $${dateParamIdx} OR (t.created_at = $${dateParamIdx} AND t.id < $${idParamIdx}))`;
      dataParams.push(new Date(parsedCursor.createdAt), parsedCursor.id);
    }

    // Fetch limit + 1 to determine if next page exists without full COUNT(*)
    const fetchLimit = limitNum + 1;
    const limitIdx = dataParams.length + 1;
    dataQuery += ` ORDER BY t.created_at DESC, t.id DESC LIMIT $${limitIdx}`;
    dataParams.push(fetchLimit);

    const transactionsResult = await pool.query(dataQuery, dataParams);
    const rows = transactionsResult.rows;

    const hasMore = rows.length > limitNum;
    const transactions = hasMore ? rows.slice(0, limitNum) : rows;

    let nextCursor = null;
    if (hasMore && transactions.length > 0) {
      const lastItem = transactions[transactions.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: lastItem.created_at, id: lastItem.id })
      ).toString('base64');
    }

    return {
      transactions,
      pagination: {
        type: 'cursor',
        limit: limitNum,
        hasMore,
        nextCursor,
      },
    };
  }

  // Path B: Traditional Offset Pagination (100% backward compatible for existing callers & tests)
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * limitNum;

  let countQuery = `
    SELECT COUNT(*) AS total
    FROM transactions t
    JOIN accounts s_acc ON t.sender_account_id = s_acc.id
    JOIN accounts r_acc ON t.receiver_account_id = r_acc.id
    WHERE (s_acc.user_id = $1 OR r_acc.user_id = $1)
  `;
  const countParams = [userId];

  if (accountId) {
    countQuery += ` AND (t.sender_account_id = $2 OR t.receiver_account_id = $2)`;
    countParams.push(accountId);
  }

  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total, 10);

  const limitIndex = dataParams.length + 1;
  const offsetIndex = dataParams.length + 2;
  dataQuery += ` ORDER BY t.created_at DESC, t.id DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
  dataParams.push(limitNum, offset);

  const transactionsResult = await pool.query(dataQuery, dataParams);
  const totalPages = Math.ceil(total / limitNum) || 1;

  return {
    transactions: transactionsResult.rows,
    pagination: {
      type: 'offset',
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
  };
};

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
