import { Worker, Job } from 'bullmq';
import pool from '../config/db';
import { SessionManager } from '../services/SessionManager';

const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

interface OutboundJobData {
  establishmentId: string;
  phone: string;
  text: string;
}

import { redisConnection } from '../config/redis';

async function recordOutboundChatMessage(establishmentId: string, phone: string, text: string) {
  const cleanPhone = phone.split('@')[0];
  try {
    await pool.query(
      `INSERT INTO whatsapp_messages (establishment_id, phone, message_text, from_me, created_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [establishmentId, cleanPhone, text]
    );

    await pool.query(
      `UPDATE whatsapp_chats 
       SET last_message_time = NOW()
       WHERE establishment_id = $1 AND phone = $2`,
      [establishmentId, cleanPhone]
    );

    await redisConnection.publish('whatsapp-chat-updates', JSON.stringify({
      establishmentId,
      phone: cleanPhone,
      text,
      fromMe: true,
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    console.error(`[OutboundWorker] Failed updating chat last_message_time:`, err);
  }
}

export const outboundWorker = new Worker<OutboundJobData>(
  'whatsapp-outbound-queue',
  async (job: Job<OutboundJobData>) => {
    const { establishmentId, phone, text } = job.data;
    const sessionManager = SessionManager.getInstance(pool);

    console.log(`[OutboundWorker] Dispatching message to ${phone} (Establishment: ${establishmentId})...`);

    const success = await sessionManager.sendMessage(establishmentId, phone, text);

    if (!success) {
      throw new Error(`Outbound message failed. No active WhatsApp session for establishment ${establishmentId}.`);
    }

    // Log sent message in whatsapp_messages for history
    await recordOutboundChatMessage(establishmentId, phone, text);
  },
  {
    connection: { host: redisHost, port: redisPort },
    concurrency: 50,
  }
);
