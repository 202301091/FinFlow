import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { redisClient, isRedisAvailable } from '../config/redis.js';
import logger from '../config/logger.js';

/**
 * Broadcast notification payload to user's Redis Pub/Sub channel.
 */
export const publishNotification = async (userId, notification) => {
  try {
    if (isRedisAvailable()) {
      const channel = `notifications:user:${userId}`;
      await redisClient.publish(channel, JSON.stringify(notification));
    }
  } catch (error) {
    logger.warn({ err: error }, `[NotificationService] Failed to publish real-time notification: ${error.message}`);
  }
};

export const createNotification = async ({
  userId,
  type,
  title,
  message,
  metadata = {},
}) => {
  if (!userId || typeof userId !== 'string') {
    throw new ApiError(400, 'Valid userId is required for notification creation');
  }
  if (!type || !title || !message) {
    throw new ApiError(400, 'type, title, and message are required for notification');
  }

  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, type, title, message, metadata, is_read, created_at`,
    [userId, type, title, message, JSON.stringify(metadata)]
  );

  const createdNotification = result.rows[0];
  await publishNotification(userId, createdNotification);
  return createdNotification;
};

export const createTransferNotifications = async ({
  transaction,
  senderUserId,
  receiverUserId,
  senderAccount,
  receiverAccount,
  amount,
  currency = 'INR',
  description = null,
}) => {
  try {
    const usersResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id IN ($1, $2)',
      [senderUserId, receiverUserId]
    );

    const senderUser = usersResult.rows.find((u) => u.id === senderUserId);
    const receiverUser = usersResult.rows.find((u) => u.id === receiverUserId);

    const senderName = senderUser?.name || 'A FinFlow User';
    const receiverName = receiverUser?.name || 'A FinFlow User';

    const formattedAmount = Number(amount).toFixed(2);
    const currencyPrefix = currency === 'INR' ? '₹' : `${currency} `;

    const senderPayload = {
      userId: senderUserId,
      type: 'TRANSFER_SENT',
      title: 'Money Sent',
      message: `${currencyPrefix}${formattedAmount} debited from your ${senderAccount.account_type || 'account'} account for transfer to ${receiverName}.`,
      metadata: {
        transactionId: transaction.id,
        amount: Number(amount),
        currency,
        counterpartyUserId: receiverUserId,
        counterpartyName: receiverName,
        senderAccountId: senderAccount.id,
        receiverAccountId: receiverAccount.id,
        description: description ? description.trim() : null,
      },
    };

    const receiverPayload = {
      userId: receiverUserId,
      type: 'TRANSFER_RECEIVED',
      title: 'Money Received',
      message: `${currencyPrefix}${formattedAmount} credited to your ${receiverAccount.account_type || 'account'} account from ${senderName}.`,
      metadata: {
        transactionId: transaction.id,
        amount: Number(amount),
        currency,
        counterpartyUserId: senderUserId,
        counterpartyName: senderName,
        senderAccountId: senderAccount.id,
        receiverAccountId: receiverAccount.id,
        description: description ? description.trim() : null,
      },
    };

    const [senderRes, receiverRes] = await Promise.allSettled([
      createNotification(senderPayload),
      createNotification(receiverPayload),
    ]);

    const senderNotification = senderRes.status === 'fulfilled' ? senderRes.value : null;
    const receiverNotification = receiverRes.status === 'fulfilled' ? receiverRes.value : null;

    if (senderRes.status === 'rejected') {
      logger.warn({ err: senderRes.reason }, `[NotificationService] Sender notification failed: ${senderRes.reason?.message}`);
    }
    if (receiverRes.status === 'rejected') {
      logger.warn({ err: receiverRes.reason }, `[NotificationService] Receiver notification failed: ${receiverRes.reason?.message}`);
    }

    return { senderNotification, receiverNotification };
  } catch (error) {
    logger.error({ err: error }, `[NotificationService] Failed to dispatch transfer notifications: ${error.message}`);
    return { senderNotification: null, receiverNotification: null };
  }
};

/**
 * Fetch paginated notification history for a user.
 */
export const getUserNotifications = async ({
  userId,
  page = 1,
  limit = 20,
  unreadOnly = false,
}) => {
  const numericPage = Math.max(1, parseInt(page, 10) || 1);
  const numericLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (numericPage - 1) * numericLimit;

  let query = 'SELECT * FROM notifications WHERE user_id = $1';
  const params = [userId];

  if (unreadOnly) {
    query += ' AND is_read = false';
  }

  query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
  params.push(numericLimit, offset);

  const [notificationsRes, totalCountRes, unreadCountRes] = await Promise.all([
    pool.query(query, params),
    pool.query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 ${unreadOnly ? 'AND is_read = false' : ''}`,
      [userId]
    ),
    pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    ),
  ]);

  const total = parseInt(totalCountRes.rows[0].count, 10);
  const unreadCount = parseInt(unreadCountRes.rows[0].count, 10);

  return {
    notifications: notificationsRes.rows,
    unreadCount,
    pagination: {
      currentPage: numericPage,
      totalPages: Math.ceil(total / numericLimit) || 1,
      totalItems: total,
      unreadCount,
      limit: numericLimit,
    },
  };
};

/**
 * Mark a single notification as read.
 */
export const markNotificationAsRead = async ({ userId, notificationId }) => {
  const result = await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [notificationId, userId]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Notification not found or does not belong to you');
  }

  return result.rows[0];
};

/**
 * Mark all notifications for a user as read.
 */
export const markAllNotificationsAsRead = async ({ userId }) => {
  const result = await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE user_id = $1 AND is_read = false
     RETURNING id`,
    [userId]
  );

  return {
    updatedCount: result.rows.length,
  };
};
