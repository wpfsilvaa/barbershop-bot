import Redis from 'ioredis';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';

dotenv.config();

const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redisConnection = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
});

redisConnection.on('connect', () => {
  console.log('[Redis] Successfully connected to Redis instance.');
});

redisConnection.on('error', (err) => {
  console.error('[Redis] Redis connection error:', err.message);
});

// Queue for inbound WhatsApp messages (received by Baileys -> forwarded to Bot Engine Worker)
export const inboundQueue = new Queue('whatsapp-inbound-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 500,
    },
    removeOnComplete: 200,
    removeOnFail: 1000,
  },
});

// Queue for outbound WhatsApp messages (sent from Bot Engine / Backend -> WhatsApp Gateway)
export const outboundQueue = new Queue('whatsapp-outbound-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 200,
    removeOnFail: 1000,
  },
});
