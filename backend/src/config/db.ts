import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'bot_whatsapp',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database pool.');
});

pool.on('error', (err) => {
  console.error('Unexpected database client error:', err);
});

export default pool;
