import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import { connectDB } from './config/db.js';
import { initDb } from './database/initDb.js';
import app from './app.js';

const startServer = async () => {
  try {
    await connectDB();
    await initDb();

    app.on('error', (err) => {
      console.error(`Connection error: ${err.message}`);
      throw err;
    });

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
