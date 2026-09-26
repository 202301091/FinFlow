import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const initDb = async () => {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Applying database schema to PostgreSQL...');
    await pool.query(schemaSql);
    console.log('✓ Database tables (users, accounts, transactions) and indexes created successfully!');
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// If run directly via node
if (process.argv[1] === __filename) {
  initDb()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
