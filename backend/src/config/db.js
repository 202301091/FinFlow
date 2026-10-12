import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { Pool } from 'pg';
import logger from './logger.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECT_TIMEOUT_MS) || 5000,
});

// Prevent unhandled errors on idle pool connections from crashing the process
pool.on('error', (err) => {
  logger.error({ err }, `[PostgreSQL Pool] Unexpected error on idle client: ${err.message}`);
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    logger.info('Connected to the database');
    client.release();
  } catch (error) {
    logger.error({ err: error }, `Error connecting to the database: ${error.message || error}`);
    process.exit(1);
  }
};

export { pool, connectDB };