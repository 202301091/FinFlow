import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    console.log('Connected to the database');
    client.release();
  } catch (error) {
    console.error('Error connecting to the database:', error);
    process.exit(1);
  }
};

export { pool, connectDB };