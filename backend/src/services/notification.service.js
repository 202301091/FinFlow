import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { redisClient, isRedisAvailable } from '../config/redis.js';

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
    console.warn('[NotificationService] Failed to publish real-time notification:', error.message);
  }
};

/**
 * Persist a single notification record into PostgreSQL and broadcast via Redis Pub/Sub.
 *
 * @param {Object} params
 * @param {string} params.userId - Recipient user UUID
 * @param {string} params.type - Notification type identifier (e.g. 'TRANSFER_SENT', 'TRANSFER_RECEIVED')
 * @param {string} params.title - Short summary title
 * @param {string} params.message - Human-readable notification body
 * @param {Object} [params.metadata] - Optional contextual metadata JSON
 * @returns {Promise<Object>} Created notification row
 */
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

  // Real-time broadcast to user's channel via Redis Pub/Sub
  await publishNotification(userId, createdNotification);

  return createdNotification;
};

/**
 * Dispatch personalized transfer notifications to both sender and receiver post-commit.
 *
 * @param {Object} params
 * @param {Object} params.transaction - The committed transaction row
 * @param {string} params.senderUserId - User ID of the sender
 * @param {string} params.receiverUserId - User ID of the recipient
 * @param {Object} params.senderAccount - Sender account record
 * @param {Object} params.receiverAccount - Receiver account record
 * @param {number} params.amount - Transfer amount
 * @param {string} [params.currency='INR'] - Currency code
 * @param {string} [params.description] - Transfer memo/description
 * @returns {Promise<{ senderNotification: Object|null, receiverNotification: Object|null }>}
 */
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
    // 1. Fetch user display names
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

    // 2. Prepare sender debit notification payload
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

    // 3. Prepare receiver credit notification payload
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

    // 4. Concurrently insert both notification rows
    const [senderRes, receiverRes] = await Promise.allSettled([
      createNotification(senderPayload),
      createNotification(receiverPayload),
    ]);

    const senderNotification = senderRes.status === 'fulfilled' ? senderRes.value : null;
    const receiverNotification = receiverRes.status === 'fulfilled' ? receiverRes.value : null;

    if (senderRes.status === 'rejected') {
      console.warn('[NotificationService] Sender notification failed:', senderRes.reason?.message);
    }
    if (receiverRes.status === 'rejected') {
      console.warn('[NotificationService] Receiver notification failed:', receiverRes.reason?.message);
    }

    return { senderNotification, receiverNotification };
  } catch (error) {
    console.error('[NotificationService] Failed to dispatch transfer notifications:', error.message);
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
