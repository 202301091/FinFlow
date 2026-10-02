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

const __filename = fileURLToPath(import.meta.url);

let consumerInstance = null;
let isShuttingDown = false;

/**
 * Format notifications for sender and receiver accounts from a transaction event.
 *
 * @param {Object} event - Valid TRANSACTION_COMPLETED domain event
 * @returns {{ senderNotification: Object, receiverNotification: Object }}
 */
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

/**
 * Dispatch an individual notification payload to downstream channels.
 * In production, this integrates with AWS SNS, Twilio, SendGrid, FCM, etc.
 *
 * @param {Object} notification
 * @returns {Promise<Object>} Delivery confirmation
 */
export const dispatchNotification = async (notification) => {
  // Structured logging for audit trails and monitoring
  console.log(
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

/**
 * Process a single domain event payload.
 *
 * @param {Object} event
 * @returns {Promise<Object>} Processing summary
 */
export const processNotificationEvent = async (event) => {
  if (!isValidTransactionCompletedEvent(event)) {
    console.warn('[Notification Worker] Ignored malformed or unrecognized event payload:', event?.eventType || 'UNKNOWN');
    return { processed: false, reason: 'INVALID_EVENT_SCHEMA' };
  }

  // Idempotency check: deduplicate on (consumer_group, event_id)
  const isFirstTime = await markEventProcessed(
    KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
    event.eventId,
    event.eventType
  );

  if (!isFirstTime) {
    console.log(`[Notification Worker] [DUPLICATE] Event ${event.eventId} already processed. Skipping.`);
    return { processed: false, duplicate: true, eventId: event.eventId };
  }

  const { senderNotification, receiverNotification } = formatNotification(event);

  const [senderResult, receiverResult] = await Promise.all([
    dispatchNotification(senderNotification),
    dispatchNotification(receiverNotification),
  ]);

  return {
    processed: true,
    eventId: event.eventId,
    transactionId: event.data.transactionId,
    deliveries: [senderResult, receiverResult],
  };
};

/**
 * KafkaJS message handler for notification consumer.
 *
 * @param {Object} payload
 * @param {string} payload.topic
 * @param {number} payload.partition
 * @param {import('kafkajs').KafkaMessage} payload.message
 */
export const handleNotificationMessage = async ({ topic, partition, message }) => {
  let parsedEvent = null;
  try {
    const rawValue = message.value ? message.value.toString('utf8') : null;
    if (!rawValue) {
      console.warn(`[Notification Worker] Received empty message on topic ${topic} (partition ${partition})`);
      return;
    }

    try {
      parsedEvent = JSON.parse(rawValue);
    } catch (parseErr) {
      console.error(`[Notification Worker] Poison pill JSON on topic ${topic}:`, parseErr.message);
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
      console.log(`[Notification Worker] Skipping unhandled eventType: ${parsedEvent.eventType}`);
    }
  } catch (error) {
    console.error(`[Notification Worker] Retries exhausted for message on topic ${topic}:`, error.message);
    await recordDeadLetter({
      consumerGroup: KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
      topic,
      event: parsedEvent,
      error,
      retryCount: 3,
    });
  }
};

/**
 * Start the notification consumer worker.
 *
 * @param {Object} [options]
 * @param {string} [options.groupId=KAFKA_CONSUMER_GROUPS.NOTIFICATIONS]
 * @param {string} [options.topic=KAFKA_TOPICS.TRANSACTIONS]
 * @returns {Promise<import('kafkajs').Consumer>}
 */
export const startNotificationWorker = async ({
  groupId = KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
  topic = KAFKA_TOPICS.TRANSACTIONS,
} = {}) => {
  console.log(`[Notification Worker] Initializing consumer (group: '${groupId}', topic: '${topic}')...`);

  consumerInstance = createConsumer({ groupId });

  await consumerInstance.connect();
  console.log(`[Notification Worker] Connected to Kafka broker successfully`);

  await consumerInstance.subscribe({
    topic,
    fromBeginning: false,
  });

  await consumerInstance.run({
    autoCommit: true,
    eachMessage: handleNotificationMessage,
  });

  console.log(`[Notification Worker] Active and listening for transaction events on '${topic}'`);
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

  console.log('[Notification Worker] Shutting down notification consumer...');
  try {
    await consumerInstance.disconnect();
    console.log('[Notification Worker] Disconnected cleanly');
  } catch (error) {
    console.warn('[Notification Worker] Error during disconnect:', error.message);
  } finally {
    consumerInstance = null;
    isShuttingDown = false;
  }
};

// Standalone execution entrypoint
if (process.argv[1] === __filename) {
  const handleExitSignal = async (signal) => {
    console.log(`\n[Notification Worker] Received ${signal}. Initiating graceful shutdown...`);
    await stopNotificationWorker();
    process.exit(0);
  };

  process.on('SIGINT', () => handleExitSignal('SIGINT'));
  process.on('SIGTERM', () => handleExitSignal('SIGTERM'));

  startNotificationWorker().catch((err) => {
    console.error('[Notification Worker] Fatal startup failure:', err.message);
    process.exit(1);
  });
}
