import { redisSubscriber, isRedisAvailable } from '../config/redis.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
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

    // 1. Establish SSE protocol headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for reverse proxies/NGINX
    res.flushHeaders?.();

    // 2. Send initial connection confirmation event
    res.write(
      `data: ${JSON.stringify({
        type: 'CONNECTED',
        userId,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    const channel = `notifications:user:${userId}`;

    // 3. Define subscriber listener callback
    const messageListener = (message) => {
      try {
        res.write(`data: ${message}\n\n`);
      } catch (err) {
        console.error('[SSE] Failed to write event to response stream:', err.message);
      }
    };

    // 4. Subscribe to the user's private Redis channel
    if (redisSubscriber && redisSubscriber.isOpen) {
      await redisSubscriber.subscribe(channel, messageListener);
    } else {
      console.warn('[SSE] Redis subscriber not ready. Live streaming suspended.');
    }

    // 5. Keep-alive heartbeat comment every 25 seconds to prevent network timeouts
    const heartbeatTimer = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    // 6. Handle client disconnect and release resources
    req.on('close', async () => {
      clearInterval(heartbeatTimer);
      try {
        if (redisSubscriber && redisSubscriber.isOpen) {
          await redisSubscriber.unsubscribe(channel, messageListener);
        }
      } catch (unsubscribeErr) {
        console.warn('[SSE] Unsubscribe error on disconnect:', unsubscribeErr.message);
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
