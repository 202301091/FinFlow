import { redisSubscriber, isRedisAvailable } from '../config/redis.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import logger from '../config/logger.js';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '../services/notification.service.js';

/**
 * Server-Sent Events (SSE) streaming endpoint for live real-time notifications.
 * GET /api/v1/notifications/stream
 */
export const streamNotifications = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required for notification stream');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write(
      `data: ${JSON.stringify({
        type: 'CONNECTED',
        userId,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    const channel = `notifications:user:${userId}`;

    const messageListener = (message) => {
      try {
        res.write(`data: ${message}\n\n`);
      } catch (err) {
        logger.error({ err }, `[SSE] Failed to write event to response stream: ${err.message}`);
      }
    };

    if (redisSubscriber && redisSubscriber.isOpen) {
      await redisSubscriber.subscribe(channel, messageListener);
    } else {
      logger.warn('[SSE] Redis subscriber not ready. Live streaming suspended.');
    }

    // Keep-alive heartbeat every 25 seconds to prevent network timeouts
    const heartbeatTimer = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', async () => {
      clearInterval(heartbeatTimer);
      try {
        if (redisSubscriber && redisSubscriber.isOpen) {
          await redisSubscriber.unsubscribe(channel, messageListener);
        }
      } catch (unsubscribeErr) {
        logger.warn({ err: unsubscribeErr }, `[SSE] Unsubscribe error on disconnect: ${unsubscribeErr.message}`);
      }
      res.end();
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get paginated notification history for the authenticated user.
 * GET /api/v1/notifications
 */
export const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

    const { page = 1, limit = 20, unreadOnly = 'false' } = req.query;

    const result = await getUserNotifications({
      userId,
      page,
      limit,
      unreadOnly: unreadOnly === 'true',
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, 'Notifications retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a single notification as read.
 * PATCH /api/v1/notifications/:id/read
 */
export const markRead = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

    const { id } = req.params;
    const updated = await markNotificationAsRead({ userId, notificationId: id });

    return res
      .status(200)
      .json(new ApiResponse(200, updated, 'Notification marked as read'));
  } catch (error) {
    next(error);
  }
};

/**
 * Mark all notifications for the user as read.
 * PATCH /api/v1/notifications/read-all
 */
export const markAllRead = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'User authentication required');
    }

    const result = await markAllNotificationsAsRead({ userId });

    return res
      .status(200)
      .json(new ApiResponse(200, result, 'All notifications marked as read'));
  } catch (error) {
    next(error);
  }
};
