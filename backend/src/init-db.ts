import fs from 'fs';
import path from 'path';
import pool from './config/db';

async function initDatabase() {
  console.log('Starting PostgreSQL database initialization...');
  
  const sqlPath = path.join(__dirname, '../schema.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`Schema SQL file not found at: ${sqlPath}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  try {
    console.log('Connecting to PostgreSQL and running migrations...');
    await pool.query(sqlContent);
    console.log('✅ Database schemas created and initial seed data populated successfully.');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  } finally {
    await pool.end();
    console.log('Pool closed.');
  }
}

initDatabase();
