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

// Fraud evaluation thresholds (configurable via environment)
export const FRAUD_CONFIG = {
  HIGH_VALUE_THRESHOLD: Number(process.env.FRAUD_HIGH_VALUE_THRESHOLD) || 100000,
  VELOCITY_MAX_TRANSFERS: Number(process.env.FRAUD_VELOCITY_MAX_TRANSFERS) || 3,
  VELOCITY_WINDOW_MS: Number(process.env.FRAUD_VELOCITY_WINDOW_MS) || 60000, // 60 seconds
};

// In-memory sliding window cache for account transaction timestamps
const accountVelocityTracker = new Map();

/**
 * Reset or clear the velocity tracker (useful for testing and memory maintenance).
 */
export const clearVelocityTracker = () => {
  accountVelocityTracker.clear();
};

/**
 * Check velocity burst for an account within a sliding time window.
 *
 * @param {string} accountId
 * @param {number} currentTimestampMs
 * @param {number} maxCount
 * @param {number} windowMs
 * @returns {{ exceeded: boolean, count: number }}
 */
export const checkAccountVelocity = (
  accountId,
  currentTimestampMs = Date.now(),
  maxCount = FRAUD_CONFIG.VELOCITY_MAX_TRANSFERS,
  windowMs = FRAUD_CONFIG.VELOCITY_WINDOW_MS
) => {
  const cutoff = currentTimestampMs - windowMs;
  const history = accountVelocityTracker.get(accountId) || [];

  // Prune expired timestamps
  const activeTimestamps = history.filter((t) => t > cutoff);
  activeTimestamps.push(currentTimestampMs);

  accountVelocityTracker.set(accountId, activeTimestamps);

  return {
    exceeded: activeTimestamps.length > maxCount,
    count: activeTimestamps.length,
  };
};

/**
 * Evaluate heuristic fraud detection rules against a transaction event.
 *
 * @param {Object} event - Domain event adhering to TRANSACTION_COMPLETED contract
 * @returns {Object} Evaluation summary with flagged status, risk score, and triggered rules
 */
export const evaluateFraudRules = (event) => {
  if (!isValidTransactionCompletedEvent(event)) {
    return {
      isSuspicious: false,
      riskScore: 0,
      triggeredRules: [],
      reason: 'INVALID_EVENT_SCHEMA',
    };
  }

  const { transactionId, senderAccountId, amount, currency = 'INR' } = event.data;
  const eventTimeMs = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
  const triggeredRules = [];
  let riskScore = 0;

  // Rule 1: High-Value Transfer Spike
  if (Number(amount) >= FRAUD_CONFIG.HIGH_VALUE_THRESHOLD) {
    triggeredRules.push({
      rule: 'HIGH_VALUE_TRANSFER',
      severity: 'HIGH',
      description: `Transfer amount (${currency} ${amount}) exceeds threshold (${currency} ${FRAUD_CONFIG.HIGH_VALUE_THRESHOLD})`,
      threshold: FRAUD_CONFIG.HIGH_VALUE_THRESHOLD,
      actualAmount: Number(amount),
    });
    riskScore += 60;
  }

  // Rule 2: Rapid-Fire Velocity Burst
  const velocity = checkAccountVelocity(senderAccountId, eventTimeMs);
  if (velocity.exceeded) {
    triggeredRules.push({
      rule: 'RAPID_VELOCITY_BURST',
      severity: 'HIGH',
      description: `Account initiated ${velocity.count} transfers within ${FRAUD_CONFIG.VELOCITY_WINDOW_MS / 1000}s (max allowed: ${FRAUD_CONFIG.VELOCITY_MAX_TRANSFERS})`,
      count: velocity.count,
      maxAllowed: FRAUD_CONFIG.VELOCITY_MAX_TRANSFERS,
    });
    riskScore += 50;
  }

  const isSuspicious = triggeredRules.length > 0;
  // Cap normalized risk score at 100
  const normalizedRiskScore = Math.min(riskScore, 100);

  return {
    isSuspicious,
    riskScore: normalizedRiskScore,
    severity: normalizedRiskScore >= 70 ? 'HIGH' : normalizedRiskScore >= 40 ? 'MEDIUM' : 'LOW',
    triggeredRules,
    transactionId,
    senderAccountId,
    amount: Number(amount),
    currency,
    timestamp: event.timestamp,
  };
};

/**
 * Handle dispatching / recording of a flagged fraud alert.
 *
 * @param {Object} evaluation - Evaluation result from evaluateFraudRules
 * @returns {Promise<Object>} Persisted alert record
 */
export const dispatchFraudAlert = async (evaluation) => {
  const alertRecord = {
    alertId: crypto.randomUUID(),
    eventType: 'FRAUD_ALERT_FLAGGED',
    severity: evaluation.severity,
    riskScore: evaluation.riskScore,
    transactionId: evaluation.transactionId,
    senderAccountId: evaluation.senderAccountId,
    amount: evaluation.amount,
    currency: evaluation.currency,
    triggeredRules: evaluation.triggeredRules,
    createdAt: new Date().toISOString(),
  };

  console.warn(
    `[Fraud Worker] [ALERT - ${alertRecord.severity}] Tx: ${alertRecord.transactionId} | Score: ${alertRecord.riskScore}/100 | Rules: [${evaluation.triggeredRules.map((r) => r.rule).join(', ')}]`
  );

  return alertRecord;
};

/**
 * Process a transaction event for fraud analysis.
 *
 * @param {Object} event
 * @returns {Promise<Object>} Processing result
 */
export const processFraudEvent = async (event) => {
  if (!isValidTransactionCompletedEvent(event)) {
    return {
      flagged: false,
      reason: 'INVALID_EVENT_SCHEMA',
    };
  }

  // Idempotency check: deduplicate on (consumer_group, event_id)
  const isFirstTime = await markEventProcessed(
    KAFKA_CONSUMER_GROUPS.FRAUD,
    event.eventId,
    event.eventType
  );

  if (!isFirstTime) {
    console.log(`[Fraud Worker] [DUPLICATE] Event ${event.eventId} already evaluated. Skipping.`);
    return { flagged: false, duplicate: true, eventId: event.eventId };
  }

  const evaluation = evaluateFraudRules(event);

  if (evaluation.isSuspicious) {
    const alert = await dispatchFraudAlert(evaluation);
    return {
      flagged: true,
      alert,
      evaluation,
    };
  }

  return {
    flagged: false,
    evaluation,
  };
};

/**
 * KafkaJS message handler for fraud consumer.
 *
 * @param {Object} payload
 * @param {string} payload.topic
 * @param {number} payload.partition
 * @param {import('kafkajs').KafkaMessage} payload.message
 */
export const handleFraudMessage = async ({ topic, partition, message }) => {
  let parsedEvent = null;
  try {
    const rawValue = message.value ? message.value.toString('utf8') : null;
    if (!rawValue) return;

    try {
      parsedEvent = JSON.parse(rawValue);
    } catch (parseErr) {
      console.error(`[Fraud Worker] Poison pill JSON on ${topic}:`, parseErr.message);
      await recordDeadLetter({
        consumerGroup: KAFKA_CONSUMER_GROUPS.FRAUD,
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
          await processFraudEvent(parsedEvent);
        },
        { maxRetries: 3, baseDelayMs: 100 }
      );
    }
  } catch (error) {
    console.error(`[Fraud Worker] Retries exhausted for message on ${topic}:`, error.message);
    await recordDeadLetter({
      consumerGroup: KAFKA_CONSUMER_GROUPS.FRAUD,
      topic,
      event: parsedEvent,
      error,
      retryCount: 3,
    });
  }
};

let consumerInstance = null;
let isShuttingDown = false;

/**
 * Start the fraud detection consumer worker.
 *
 * @param {Object} [options]
 * @param {string} [options.groupId=KAFKA_CONSUMER_GROUPS.FRAUD]
 * @param {string} [options.topic=KAFKA_TOPICS.TRANSACTIONS]
 * @returns {Promise<import('kafkajs').Consumer>}
 */
export const startFraudWorker = async ({
  groupId = KAFKA_CONSUMER_GROUPS.FRAUD,
  topic = KAFKA_TOPICS.TRANSACTIONS,
} = {}) => {
  console.log(`[Fraud Worker] Initializing consumer (group: '${groupId}', topic: '${topic}')...`);

  consumerInstance = createConsumer({ groupId });

  await consumerInstance.connect();
  console.log(`[Fraud Worker] Connected to Kafka broker successfully`);

  await consumerInstance.subscribe({
    topic,
    fromBeginning: false,
  });

  await consumerInstance.run({
    autoCommit: true,
    eachMessage: handleFraudMessage,
  });

  console.log(`[Fraud Worker] Active and monitoring transactions on '${topic}'`);
  return consumerInstance;
};

/**
 * Gracefully stop the fraud consumer worker.
 *
 * @returns {Promise<void>}
 */
export const stopFraudWorker = async () => {
  if (isShuttingDown || !consumerInstance) return;
  isShuttingDown = true;

  console.log('[Fraud Worker] Shutting down fraud consumer...');
  try {
    await consumerInstance.disconnect();
    console.log('[Fraud Worker] Disconnected cleanly');
  } catch (error) {
    console.warn('[Fraud Worker] Error during disconnect:', error.message);
  } finally {
    consumerInstance = null;
    isShuttingDown = false;
  }
};

// Standalone execution entrypoint
if (process.argv[1] === __filename) {
  const handleExitSignal = async (signal) => {
    console.log(`\n[Fraud Worker] Received ${signal}. Initiating graceful shutdown...`);
    await stopFraudWorker();
    process.exit(0);
  };

  process.on('SIGINT', () => handleExitSignal('SIGINT'));
  process.on('SIGTERM', () => handleExitSignal('SIGTERM'));

  startFraudWorker().catch((err) => {
    console.error('[Fraud Worker] Fatal startup failure:', err.message);
    process.exit(1);
  });
}
