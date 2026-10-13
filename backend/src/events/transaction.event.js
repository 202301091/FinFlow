import crypto from 'crypto';

export const EVENT_TYPES = {
  TRANSACTION_COMPLETED: 'TRANSACTION_COMPLETED',
};

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
