import { Worker, Job } from 'bullmq';
import pool from '../config/db';
import { SessionManager } from '../services/SessionManager';

const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

interface OutboundJobData {
  establishmentId: string;
  phone: string;
  text: string;
  isManual?: boolean;
}

import { redisConnection } from '../config/redis';

async function recordOutboundChatMessage(establishmentId: string, phone: string, text: string) {
  let cleanPhone = phone.split('@')[0].replace(/\D/g, '');
  if (!cleanPhone.startsWith('55') || cleanPhone.length >= 13) {
    try {
      const lidRes = await pool.query(`SELECT phone FROM lid_mappings WHERE lid = $1`, [cleanPhone]);
      if (lidRes.rows.length > 0 && lidRes.rows[0].phone) {
        cleanPhone = lidRes.rows[0].phone.replace(/\D/g, '');
      }
    } catch (e) {}
  }
  if (cleanPhone.startsWith('55') && cleanPhone.length === 12) {
    cleanPhone = cleanPhone.substring(0, 4) + '9' + cleanPhone.substring(4);
  }
  try {
    await pool.query(
      `INSERT INTO whatsapp_messages (establishment_id, phone, message_text, from_me, created_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [establishmentId, cleanPhone, text]
    );

    const clientRes = await pool.query(
      `SELECT name FROM clients WHERE establishment_id = $1 AND phone = $2 LIMIT 1`,
      [establishmentId, cleanPhone]
    );
    const clientName = clientRes.rows[0]?.name || 'Cliente';

    await pool.query(
      `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, current_node_id, waiting_for_input, push_name, last_message_time)
       VALUES ($1, $2, 'PAUSED', 'welcome', false, $3, NOW())
       ON CONFLICT (establishment_id, phone)
       DO UPDATE SET last_message_time = NOW()`,
      [establishmentId, cleanPhone, clientName]
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
    const { establishmentId, phone, text, isManual } = job.data;
    const sessionManager = SessionManager.getInstance(pool);

    console.log(`[OutboundWorker] Dispatching message to ${phone} (Establishment: ${establishmentId}, isManual: ${!!isManual})...`);

    const success = await sessionManager.sendMessage(establishmentId, phone, text, !!isManual);

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
