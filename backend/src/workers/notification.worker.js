import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  createConsumer,
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
} from '../config/kafka.js';
import {
  EVENT_TYPES,
  isValidTransactionCompletedEvent,
} from '../events/transaction.event.js';
import { markEventProcessed } from '../services/consumerIdempotency.service.js';
import { executeWithRetry, recordDeadLetter } from '../services/consumerRetry.service.js';
import { createTransferNotifications } from '../services/notification.service.js';
import { markOutboxProcessed } from '../services/outbox.service.js';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);

let consumerInstance = null;
let isShuttingDown = false;

export const formatNotification = (event) => {
  const {
    transactionId,
    senderUserId,
    receiverUserId,
    senderAccountId,
    receiverAccountId,
    amount,
    currency = 'INR',
    description,
  } = event.data;

  const formattedAmount = `${currency} ${Number(amount).toFixed(2)}`;
  const memoText = description ? ` | Memo: "${description}"` : '';

  const senderNotification = {
    id: crypto.randomUUID(),
    recipientUserId: senderUserId || null,
    recipientAccountId: senderAccountId,
    channel: 'SMS_PUSH_EMAIL',
    type: 'DEBIT_ALERT',
    title: 'FinFlow: Account Debited',
    message: `Your account ${senderAccountId} was debited ${formattedAmount} for transfer to account ${receiverAccountId}.${memoText} Ref: ${transactionId}`,
    amount: Number(amount),
    currency,
    transactionId,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  const receiverNotification = {
    id: crypto.randomUUID(),
    recipientUserId: receiverUserId || null,
    recipientAccountId: receiverAccountId,
    channel: 'SMS_PUSH_EMAIL',
    type: 'CREDIT_ALERT',
    title: 'FinFlow: Account Credited',
    message: `Your account ${receiverAccountId} was credited ${formattedAmount} from account ${senderAccountId}.${memoText} Ref: ${transactionId}`,
    amount: Number(amount),
    currency,
    transactionId,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  return { senderNotification, receiverNotification };
};

export const dispatchNotification = async (notification) => {
  logger.info(
    `[Notification Worker] [${notification.type}] Account: ${notification.recipientAccountId} | ${notification.message}`
  );

  return {
    deliveryId: crypto.randomUUID(),
    status: 'DELIVERED',
    notificationId: notification.id,
    recipientAccountId: notification.recipientAccountId,
    deliveredAt: new Date().toISOString(),
  };
};

export const processNotificationEvent = async (event) => {
  if (!isValidTransactionCompletedEvent(event)) {
    logger.warn({ eventType: event?.eventType }, `[Notification Worker] Ignored malformed or unrecognized event payload: ${event?.eventType || 'UNKNOWN'}`);
    return { processed: false, reason: 'INVALID_EVENT_SCHEMA' };
  }

  // Idempotency check: deduplicate on (consumer_group, event_id)
  const isFirstTime = await markEventProcessed(
    KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
    event.eventId,
    event.eventType
  );

  if (!isFirstTime) {
    logger.info(`[Notification Worker] [DUPLICATE] Event ${event.eventId} already processed. Skipping.`);
    return { processed: false, duplicate: true, eventId: event.eventId };
  }

  const { senderNotification, receiverNotification } = formatNotification(event);

  // 1. Create real database records in PostgreSQL and broadcast to Redis Pub/Sub for live SSE
  let dbNotifications = null;
  try {
    dbNotifications = await createTransferNotifications({
      transaction: { id: event.data.transactionId },
      senderUserId: event.data.senderUserId,
      receiverUserId: event.data.receiverUserId,
      senderAccount: { id: event.data.senderAccountId, account_type: 'savings' },
      receiverAccount: { id: event.data.receiverAccountId, account_type: 'savings' },
      amount: event.data.amount,
      currency: event.data.currency || 'INR',
      description: event.data.description,
    });
  } catch (notifErr) {
    logger.warn({ err: notifErr, eventId: event.eventId }, `[Notification Worker] Error persisting notifications to database: ${notifErr.message}`);
  }

  // 2. Dispatch simulated / channel notifications (logging, SMS, Email)
  const [senderResult, receiverResult] = await Promise.all([
    dispatchNotification(senderNotification),
    dispatchNotification(receiverNotification),
  ]);

  // 3. Update transactional outbox record status to PROCESSED
  await markOutboxProcessed(event.data.transactionId);

  return {
    processed: true,
    eventId: event.eventId,
    transactionId: event.data.transactionId,
    dbNotifications,
    deliveries: [senderResult, receiverResult],
  };
};

export const handleNotificationMessage = async ({ topic, partition, message }) => {
  let parsedEvent = null;
  try {
    const rawValue = message.value ? message.value.toString('utf8') : null;
    if (!rawValue) {
      logger.warn({ topic, partition }, `[Notification Worker] Received empty message on topic ${topic} (partition ${partition})`);
      return;
    }

    try {
      parsedEvent = JSON.parse(rawValue);
    } catch (parseErr) {
      logger.error({ err: parseErr, topic }, `[Notification Worker] Poison pill JSON on topic ${topic}: ${parseErr.message}`);
      await recordDeadLetter({
        consumerGroup: KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
        topic,
        event: { raw: rawValue },
        error: parseErr,
        retryCount: 0,
      });
      return;
    }

    if (parsedEvent.eventType === EVENT_TYPES.TRANSACTION_COMPLETED) {
      await executeWithRetry(
        async () => {
          await processNotificationEvent(parsedEvent);
        },
        { maxRetries: 3, baseDelayMs: 100 }
      );
    } else {
      logger.info(`[Notification Worker] Skipping unhandled eventType: ${parsedEvent.eventType}`);
    }
  } catch (error) {
    logger.error({ err: error, topic }, `[Notification Worker] Retries exhausted for message on topic ${topic}: ${error.message}`);
    await recordDeadLetter({
      consumerGroup: KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
      topic,
      event: parsedEvent,
      error,
      retryCount: 3,
    });
  }
};

export const startNotificationWorker = async ({
  groupId = KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
  topic = KAFKA_TOPICS.TRANSACTIONS,
} = {}) => {
  logger.info(`[Notification Worker] Initializing consumer (group: '${groupId}', topic: '${topic}')...`);

  consumerInstance = createConsumer({ groupId });

  await consumerInstance.connect();
  logger.info('[Notification Worker] Connected to Kafka broker successfully');

  await consumerInstance.subscribe({
    topic,
    fromBeginning: false,
  });

  await consumerInstance.run({
    autoCommit: true,
    eachMessage: handleNotificationMessage,
  });

  logger.info(`[Notification Worker] Active and listening for transaction events on '${topic}'`);
  return consumerInstance;
};

/**
 * Gracefully stop and disconnect the notification consumer worker.
 *
 * @returns {Promise<void>}
 */
export const stopNotificationWorker = async () => {
  if (isShuttingDown || !consumerInstance) return;
  isShuttingDown = true;

  logger.info('[Notification Worker] Shutting down notification consumer...');
  try {
    await consumerInstance.disconnect();
    logger.info('[Notification Worker] Disconnected cleanly');
  } catch (error) {
    logger.warn({ err: error }, `[Notification Worker] Error during disconnect: ${error.message}`);
  } finally {
    consumerInstance = null;
    isShuttingDown = false;
  }
};

// Standalone execution entrypoint
if (process.argv[1] === __filename) {
  const handleExitSignal = async (signal) => {
    logger.info(`[Notification Worker] Received ${signal}. Initiating graceful shutdown...`);
    await stopNotificationWorker();
    process.exit(0);
  };

  process.on('SIGINT', () => handleExitSignal('SIGINT'));
  process.on('SIGTERM', () => handleExitSignal('SIGTERM'));

  startNotificationWorker().catch((err) => {
    logger.error({ err }, `[Notification Worker] Fatal startup failure: ${err.message}`);
    process.exit(1);
  });
}
