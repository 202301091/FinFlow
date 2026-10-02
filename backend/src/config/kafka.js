import { Kafka, logLevel } from 'kafkajs';

const rawBrokers = process.env.KAFKA_BROKERS || 'localhost:9092';
const brokers = rawBrokers.split(',').map((b) => b.trim()).filter(Boolean);
const clientId = process.env.KAFKA_CLIENT_ID || 'finflow-backend';

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.argv.some((a) => typeof a === 'string' && a.includes('test')) ||
  process.execArgv.some((a) => typeof a === 'string' && a.includes('test'));

// Build optional SASL / SSL configuration for cloud / production clusters
const kafkaConfig = {
  clientId,
  brokers,
  logLevel: isTestEnv ? logLevel.NOTHING : logLevel.ERROR,
  retry: {
    initialRetryTime: isTestEnv ? 50 : 300,
    retries: isTestEnv ? 0 : 5,
  },
};

if (process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD) {
  kafkaConfig.ssl = process.env.KAFKA_SSL === 'true';
  kafkaConfig.sasl = {
    mechanism: process.env.KAFKA_SASL_MECHANISM || 'plain',
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD,
  };
} else if (process.env.KAFKA_SSL === 'true') {
  kafkaConfig.ssl = true;
}

/**
 * Singleton Kafka Client instance
 */
export const kafka = new Kafka(kafkaConfig);

/**
 * Reusable Kafka Producer instance configured with idempotence
 */
export const kafkaProducer = kafka.producer({
  idempotent: !isTestEnv,
  allowAutoTopicCreation: true,
  retry: {
    initialRetryTime: isTestEnv ? 50 : 300,
    retries: isTestEnv ? 0 : 3,
  },
});

let isProducerConnected = false;
let lastConnectionAttempt = 0;
const RECONNECT_COOLDOWN_MS = 10000; // 10s cooldown to prevent blocking requests if broker is down

kafkaProducer.on('producer.connect', () => {
  isProducerConnected = true;
  console.log('[Kafka] Producer connected to broker successfully');
});

kafkaProducer.on('producer.disconnect', () => {
  isProducerConnected = false;
  console.warn('[Kafka] Producer disconnected from broker');
});

/**
 * Connect the shared Kafka producer idempotently.
 * Non-blocking / fail-safe with circuit breaker: does not block the caller if broker is down.
 *
 * @returns {Promise<boolean>} True if connected, false if unavailable
 */
export const connectProducer = async () => {
  if (isProducerConnected) return true;

  // In test runs without active live Kafka broker, fast-exit in 0ms (events stay in outbox table)
  if (isTestEnv && !process.env.KAFKA_TEST_LIVE) {
    return false;
  }

  const now = Date.now();
  if (now - lastConnectionAttempt < RECONNECT_COOLDOWN_MS) {
    return false; // Circuit open: fast-fail without blocking
  }

  lastConnectionAttempt = now;

  try {
    await kafkaProducer.connect();
    isProducerConnected = true;
    return true;
  } catch (error) {
    isProducerConnected = false;
    return false;
  }
};

/**
 * Disconnect the shared Kafka producer.
 */
export const disconnectProducer = async () => {
  if (!isProducerConnected) return;

  try {
    await kafkaProducer.disconnect();
    isProducerConnected = false;
  } catch (error) {
    console.warn('[Kafka] Error disconnecting producer:', error.message);
  }
};

/**
 * Helper to create a new Kafka consumer instance for a worker group.
 *
 * @param {Object} options
 * @param {string} options.groupId - Consumer group identifier
 * @param {boolean} [options.allowAutoTopicCreation=true]
 * @returns {import('kafkajs').Consumer}
 */
export const createConsumer = ({ groupId, allowAutoTopicCreation = true }) => {
  if (!groupId || typeof groupId !== 'string') {
    throw new Error('[Kafka] Valid groupId is required to create a consumer');
  }

  return kafka.consumer({
    groupId,
    allowAutoTopicCreation,
    retry: {
      initialRetryTime: 300,
      retries: 8,
    },
  });
};

/**
 * Canonical topic definitions
 */
export const KAFKA_TOPICS = {
  TRANSACTIONS: process.env.KAFKA_TOPIC_TRANSACTIONS || 'transaction-events',
};

/**
 * Standard Consumer Group identifiers
 */
export const KAFKA_CONSUMER_GROUPS = {
  NOTIFICATIONS: process.env.KAFKA_GROUP_NOTIFICATIONS || 'finflow-notifications-group',
  FRAUD: process.env.KAFKA_GROUP_FRAUD || 'finflow-fraud-group',
};

/**
 * Admin helper to verify or initialize a topic with specified partitions.
 *
 * @param {Object} options
 * @param {string} [options.topic=KAFKA_TOPICS.TRANSACTIONS]
 * @param {number} [options.numPartitions=3]
 * @param {number} [options.replicationFactor=1]
 * @returns {Promise<boolean>}
 */
export const ensureTopicExists = async ({
  topic = KAFKA_TOPICS.TRANSACTIONS,
  numPartitions = 3,
  replicationFactor = 1,
} = {}) => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();

    if (!existingTopics.includes(topic)) {
      await admin.createTopics({
        topics: [
          {
            topic,
            numPartitions,
            replicationFactor,
          },
        ],
      });
      console.log(`[Kafka Admin] Created topic '${topic}' with ${numPartitions} partitions`);
    }
    return true;
  } catch (error) {
    console.warn(`[Kafka Admin] Topic check/creation for '${topic}' bypassed:`, error.message);
    return false;
  } finally {
    try {
      await admin.disconnect();
    } catch {}
  }
};

/**
 * Check if the Kafka producer is currently connected and ready.
 *
 * @returns {boolean}
 */
export const isKafkaAvailable = () => isProducerConnected;

export default kafka;
