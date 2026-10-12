import { pool } from '../config/db.js';
import logger from '../config/logger.js';

export const resetDb = async () => {
  try {
    logger.info('Wiping all backend data from database...');

    await pool.query(`
      TRUNCATE TABLE 
        consumer_dlq,
        processed_events,
        transaction_outbox,
        fraud_evaluations,
        notifications,
        audit_logs,
        idempotency_keys,
        transactions,
        accounts,
        users
      RESTART IDENTITY CASCADE;
    `);

    logger.info('✓ Successfully deleted all transactions, accounts, users, logs, and notification records!');
  } catch (error) {
    logger.error({ err: error }, `Error resetting database: ${error.message}`);
    throw error;
  } finally {
    await pool.end();
  }
};

resetDb()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
