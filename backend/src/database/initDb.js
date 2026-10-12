import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const initDb = async () => {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    logger.info('Applying database schema to PostgreSQL...');
    await pool.query(schemaSql);

    // Ensure transactions table does not have duplicate idempotency_key column
    // and ensure users table has transaction_pin_hash
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT;
      ALTER TABLE transactions DROP COLUMN IF EXISTS idempotency_key;
      DROP INDEX IF EXISTS idx_idempotency_lookup;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_non_negative_balance'
        ) THEN
          ALTER TABLE accounts ADD CONSTRAINT chk_non_negative_balance CHECK (balance >= 0);
        END IF;
      END $$;
    `);

    logger.info('✓ Database tables, constraints, and schema updated successfully!');
  } catch (error) {
    logger.error({ err: error }, `Error initializing database: ${error.message}`);
    throw error;
  }
};

// If run directly via node
if (process.argv[1] === __filename) {
  initDb()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
