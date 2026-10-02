import crypto from 'crypto';

export const EVENT_TYPES = {
  TRANSACTION_COMPLETED: 'TRANSACTION_COMPLETED',
};

/**
 * Factory function to construct a canonical, sanitized TRANSACTION_COMPLETED domain event.
 *
 * @param {Object} params
 * @param {Object} params.transaction - The committed PostgreSQL transaction record
 * @param {string} params.senderUserId - User UUID of the sender
 * @param {string} params.receiverUserId - User UUID of the receiver
 * @param {string} params.senderAccountId - Account UUID debited
 * @param {string} params.receiverAccountId - Account UUID credited
 * @param {number|string} params.amount - Numeric transfer amount
 * @param {string} [params.currency='INR'] - Currency code
 * @param {string} [params.description] - Transaction memo
 * @param {string} [params.requestId] - Distributed trace identifier
 * @returns {Object} Structured domain event
 */
export const createTransactionCompletedEvent = ({
  transaction,
  senderUserId,
  receiverUserId,
  senderAccountId,
  receiverAccountId,
  amount,
  currency = 'INR',
  description = null,
  requestId = null,
}) => {
  if (!transaction?.id) {
    throw new Error('[EventModel] transaction.id is required to create TRANSACTION_COMPLETED event');
  }
  if (!senderAccountId || !receiverAccountId) {
    throw new Error('[EventModel] senderAccountId and receiverAccountId are required');
  }

  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    throw new Error('[EventModel] amount must be a positive number');
  }

  const eventId = crypto.randomUUID();
  const timestamp = transaction.created_at
    ? new Date(transaction.created_at).toISOString()
    : new Date().toISOString();

  return {
    eventId,
    eventType: EVENT_TYPES.TRANSACTION_COMPLETED,
    aggregateType: 'TRANSACTION',
    aggregateId: transaction.id,
    timestamp,
    version: 1,
    data: {
      transactionId: transaction.id,
      senderUserId,
      receiverUserId,
      senderAccountId,
      receiverAccountId,
      amount: numericAmount,
      currency,
      description: description ? description.trim() : null,
      status: transaction.status || 'completed',
    },
    metadata: {
      requestId: requestId || null,
      source: 'finflow-backend',
    },
  };
};

/**
 * Validate that a deserialized payload adheres to the TRANSACTION_COMPLETED event contract.
 *
 * @param {any} event
 * @returns {boolean}
 */
export const isValidTransactionCompletedEvent = (event) => {
  if (!event || typeof event !== 'object') return false;
  if (!event.eventId || typeof event.eventId !== 'string') return false;
  if (event.eventType !== EVENT_TYPES.TRANSACTION_COMPLETED) return false;
  if (!event.aggregateId || typeof event.aggregateId !== 'string') return false;
  if (!event.timestamp || typeof event.timestamp !== 'string') return false;

  const data = event.data;
  if (!data || typeof data !== 'object') return false;
  if (!data.transactionId || !data.senderAccountId || !data.receiverAccountId) return false;
  if (typeof data.amount !== 'number' || data.amount <= 0) return false;

  return true;
};
