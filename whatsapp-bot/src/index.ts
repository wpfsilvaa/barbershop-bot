import dotenv from 'dotenv';
import pool from './config/db';
import { SessionManager } from './services/SessionManager';
import { redisConnection } from './config/redis';
import { botWorker } from './workers/botEngineWorker';
import { outboundWorker } from './workers/outboundWorker';

dotenv.config();

console.log('======================================================');
console.log('🚀 Starting Centralized WhatsApp Gateway & Worker Service');
console.log('======================================================');

const sessionManager = SessionManager.getInstance(pool);

async function startGateway() {
  try {
    // 1. Subscribe to Redis session commands (from backend)
    const subscriber = redisConnection.duplicate();
    await subscriber.subscribe('session:command');

    subscriber.on('message', async (channel, message) => {
      if (channel === 'session:command') {
        try {
          const { action, establishmentId } = JSON.parse(message);
          console.log(`[Gateway] Received Redis command '${action}' for establishment ${establishmentId}`);
          
          if (action === 'start') {
            await sessionManager.connect(establishmentId);
          } else if (action === 'disconnect') {
            await sessionManager.disconnectSession(establishmentId);
          }
        } catch (err: any) {
          console.error('[Gateway] Failed processing session command message:', err.message);
        }
      }
    });

    // 2. Initialize active WhatsApp sessions in controlled batches
    await sessionManager.initializeAllSessions();

    console.log('✅ WhatsApp Gateway & BullMQ Workers successfully running.');
  } catch (error: any) {
    console.error('❌ Failed starting WhatsApp Gateway service:', error.message);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// Graceful Shutdown Management (SIGTERM / SIGINT)
// -------------------------------------------------------------
async function gracefulShutdown(signal: string) {
  console.log(`\n[Shutdown] Received signal ${signal}. Initiating graceful shutdown...`);

  try {
    // 1. Close BullMQ workers from accepting new jobs
    console.log('[Shutdown] Closing BullMQ workers...');
    await botWorker.close();
    await outboundWorker.close();

    // 2. Safely close Baileys sessions & release Redis locks
    console.log('[Shutdown] Closing SessionManager sessions...');
    await sessionManager.shutdown();

    // 3. Close database and Redis pools
    console.log('[Shutdown] Closing database pool & Redis connections...');
    await pool.end();
    await redisConnection.quit();

    console.log('👋 Shutdown complete. Process exiting cleanly.');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Error during graceful shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startGateway();
