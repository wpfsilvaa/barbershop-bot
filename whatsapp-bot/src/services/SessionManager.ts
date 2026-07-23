import makeWASocket, {
  DisconnectReason,
  WASocket,
  proto,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { Pool } from 'pg';
import { usePostgresAuthState } from './dbAuthStore';
import { inboundQueue, redisConnection } from '../config/redis';

const logger = pino({ level: 'silent' });
const BOT_SIGNATURE = '🤖*';

export type SessionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'QR_READY'
  | 'CONNECTED';

export class SessionManager {
  private static instance: SessionManager;
  private sessions = new Map<string, WASocket>();
  private sessionStatuses = new Map<string, SessionStatus>();
  private processedMessages = new Set<string>();
  private pool: Pool;
  private instanceId: string;

  private constructor(pool: Pool) {
    this.pool = pool;
    this.instanceId = process.env.GATEWAY_INSTANCE_ID || `gateway-${Math.random().toString(36).substring(7)}`;
  }

  public static getInstance(pool: Pool): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager(pool);
    }
    return SessionManager.instance;
  }

  // Acquire Redis Distributed Lock for a session so only one Gateway process manages it
  private async acquireSessionLock(establishmentId: string): Promise<boolean> {
    const lockKey = `lock:session:${establishmentId}`;
    await redisConnection.set(lockKey, this.instanceId, 'EX', 30);
    return true;
  }

  private async refreshSessionLock(establishmentId: string): Promise<void> {
    const lockKey = `lock:session:${establishmentId}`;
    await redisConnection.expire(lockKey, 30);
  }

  public getSession(establishmentId: string): WASocket | undefined {
    return this.sessions.get(establishmentId);
  }

  public getStatus(establishmentId: string): SessionStatus {
    return this.sessionStatuses.get(establishmentId) || 'DISCONNECTED';
  }

  public async connect(establishmentId: string): Promise<void> {
    const status = this.sessionStatuses.get(establishmentId);
    const existingSock = this.sessions.get(establishmentId);

    if (this.sessions.has(establishmentId)) {
      const wsState = (existingSock as any)?.ws?.readyState;
      if ((status === 'CONNECTED' || status === 'QR_READY' || status === 'CONNECTING') && existingSock && wsState !== 3) {
        console.log(`[SessionManager] Session ${establishmentId} is already active (${status}) in memory.`);
        return;
      }
      try { (existingSock as any)?.end(undefined); } catch (e) {}
      this.sessions.delete(establishmentId);
    }

    // Always clear stale Redis lock for disconnected or reconnecting sessions
    await redisConnection.del(`lock:session:${establishmentId}`);

    const acquired = await this.acquireSessionLock(establishmentId);
    if (!acquired) {
      console.log(`[SessionManager] Another gateway instance is managing session ${establishmentId}. Skipping.`);
      return;
    }

    console.log(`[SessionManager] Starting connection for establishment ${establishmentId}...`);
    this.sessionStatuses.set(establishmentId, 'CONNECTING');
    await this.updateSessionStatusDB(establishmentId, 'connecting');

    try {
      const { state: authState, saveCreds } = await usePostgresAuthState(this.pool, establishmentId);

      const sock = makeWASocket({
        auth: authState,
        printQRInTerminal: false,
        logger,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        syncFullHistory: false,
        retryRequestDelayMs: 2000,
        maxMsgRetryCount: 5,
        getMessage: async (key) => {
          return proto.Message.fromObject({});
        }
      });

      // Track socket immediately so it can be safely closed on reset or disconnect
      this.sessions.set(establishmentId, sock);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.sessionStatuses.set(establishmentId, 'QR_READY');
          await this.updateSessionStatusDB(establishmentId, 'qr_ready', qr);
          
          // Publish QR Code event to Redis Pub/Sub for frontend/dashboard
          await redisConnection.publish(`qr:${establishmentId}`, JSON.stringify({ qr, establishmentId }));
          console.log(`[SessionManager] QR Code generated for establishment ${establishmentId}.`);

          // Auto-expire unscanned QR code after 60 seconds
          if ((sock as any)._qrTimer) clearTimeout((sock as any)._qrTimer);
          (sock as any)._qrTimer = setTimeout(async () => {
            if (this.sessionStatuses.get(establishmentId) === 'QR_READY') {
              console.log(`[SessionManager] QR Code expired for establishment ${establishmentId}. Resetting session.`);
              try { sock.end(undefined); } catch (e) {}
              this.sessions.delete(establishmentId);
              this.sessionStatuses.set(establishmentId, 'DISCONNECTED');
              await this.pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
              await this.updateSessionStatusDB(establishmentId, 'disconnected', null, null);
              await redisConnection.del(`lock:session:${establishmentId}`);
            }
          }, 60000);
        }

        if (connection === 'close') {
          this.sessions.delete(establishmentId);
          await redisConnection.del(`lock:session:${establishmentId}`);

          const error = lastDisconnect?.error as Boom;
          const statusCode = error?.output?.statusCode;
          const currentStatus = this.sessionStatuses.get(establishmentId);
          this.sessionStatuses.set(establishmentId, 'DISCONNECTED');

          console.log(`[SessionManager] Connection closed for ${establishmentId} (Status: ${statusCode}, PrevState: ${currentStatus}).`);

          const isLoggedOutOrPairingFailed = 
            statusCode === DisconnectReason.loggedOut || 
            statusCode === 401 || 
            statusCode === 408 || 
            currentStatus === 'QR_READY' || 
            currentStatus === 'CONNECTING';

          if (isLoggedOutOrPairingFailed) {
            console.log(`[SessionManager] Cleaning stale auth credentials for establishment ${establishmentId}...`);
            await this.pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
            await this.updateSessionStatusDB(establishmentId, 'disconnected', null, null);
          } else {
            await this.updateSessionStatusDB(establishmentId, 'disconnected', null);
            // Reconnect automatically only if session was previously fully CONNECTED
            if (currentStatus === 'CONNECTED') {
              setTimeout(() => this.connect(establishmentId), 5000);
            }
          }
        } else if (connection === 'open') {
          const phoneJid = sock.user?.id;
          const cleanPhone = phoneJid ? phoneJid.split(':')[0].split('@')[0] : null;

          this.sessions.set(establishmentId, sock);
          this.sessionStatuses.set(establishmentId, 'CONNECTED');
          console.log(`[SessionManager] Establishment ${establishmentId} CONNECTED on phone ${cleanPhone}!`);

          await this.updateSessionStatusDB(establishmentId, 'connected', null, cleanPhone);

          // Refresh lock heartbeat
          setInterval(() => this.refreshSessionLock(establishmentId), 10000);
        }
      });

      // Handle incoming messages: normalize and push to BullMQ queue
      sock.ev.on('messages.upsert', async (m) => {
        // Check if establishment & bot are active in database (skip for master admin)
        if (establishmentId !== '00000000-0000-0000-0000-000000000000') {
          try {
            const estCheck = await this.pool.query('SELECT is_active, bot_active FROM establishments WHERE id = $1', [establishmentId]);
            if (estCheck.rows.length > 0) {
              const { is_active, bot_active } = estCheck.rows[0];
              if (!is_active || bot_active === false) return;
            }
          } catch (err) {
            console.error(`[SessionManager] Error checking active status for ${establishmentId}:`, err);
          }
        }

        for (const msg of m.messages) {
          const msgId = msg.key?.id;
          if (msgId) {
            if (this.processedMessages.has(msgId)) continue;
            this.processedMessages.add(msgId);
            if (this.processedMessages.size > 2000) {
              const first = this.processedMessages.values().next().value;
              if (first) this.processedMessages.delete(first);
            }
          }

          let rawPhone = msg.key?.remoteJid;
          if (!rawPhone) continue;
          if (rawPhone.endsWith('@g.us') || rawPhone.endsWith('@broadcast')) continue;

          const cleanPhone = rawPhone.split('@')[0];
          const fromMe = !!msg.key?.fromMe;
          
          // Extract message text supporting ephemeral, extended, and media captions
          const msgContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
          const text = (
            msgContent?.conversation ||
            msgContent?.extendedTextMessage?.text ||
            msgContent?.imageMessage?.caption ||
            msgContent?.videoMessage?.caption ||
            ''
          ).trim();

          console.log(`[SessionManager] Incoming message for establishment ${establishmentId}:`, {
            fromMe,
            remoteJid: rawPhone,
            cleanPhone,
            text,
            hasMessageObj: !!msg.message
          });

          if (!text || text.includes(BOT_SIGNATURE)) continue;

          // Push job into BullMQ inbound queue
          await inboundQueue.add(
            'process-inbound-message',
            {
              establishmentId,
              phone: cleanPhone,
              rawJid: rawPhone,
              messageId: msg.key.id,
              text,
              pushName: msg.pushName || 'Cliente',
              fromMe,
              timestamp: Date.now(),
            },
            {
              jobId: `inbound:${establishmentId}:${msg.key.id}`,
            }
          );
        }
      });

    } catch (err: any) {
      console.error(`[SessionManager] Failed to create session for ${establishmentId}:`, err.message);
      this.sessionStatuses.set(establishmentId, 'DISCONNECTED');
    }
  }

  public async disconnectSession(establishmentId: string): Promise<void> {
    const sock = this.sessions.get(establishmentId);
    if (sock) {
      try {
        sock.end(undefined);
      } catch (e) {}
      this.sessions.delete(establishmentId);
      this.sessionStatuses.set(establishmentId, 'DISCONNECTED');
    }
    await this.pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
    await this.updateSessionStatusDB(establishmentId, 'disconnected', null, null);
    await redisConnection.del(`lock:session:${establishmentId}`);
  }

  public async sendMessage(establishmentId: string, phone: string, text: string): Promise<boolean> {
    const sock = this.sessions.get(establishmentId);
    if (!sock) {
      console.error(`[SessionManager] Outbound message failed. No active session for establishment ${establishmentId}.`);
      return false;
    }

    let cleanPhone = phone.replace(/\D/g, '');
    let targetJid = `${cleanPhone}@s.whatsapp.net`;

    try {
      // Resolve real WhatsApp JID (handles Brazilian 9th digit differences automatically)
      const results = await sock.onWhatsApp(cleanPhone);
      if (results && results.length > 0 && results[0].exists) {
        targetJid = results[0].jid;
      } else if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
        // Try 12-digit variant without 9th digit
        const altPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
        const altResults = await sock.onWhatsApp(altPhone);
        if (altResults && altResults.length > 0 && altResults[0].exists) {
          targetJid = altResults[0].jid;
        }
      }
    } catch (err: any) {
      console.warn(`[SessionManager] onWhatsApp query failed for ${cleanPhone}, falling back to direct JID:`, err.message);
    }

    console.log(`[SessionManager] Sending outbound message to ${targetJid} (Tenant: ${establishmentId})...`);

    const textWithSignature = `${text}\n\n${BOT_SIGNATURE}`;
    await sock.sendMessage(targetJid, { text: textWithSignature });
    return true;
  }

  // Connect active sessions in controlled batches to prevent DB/Redis connection storms
  public async initializeAllSessions(): Promise<void> {
    try {
      const res = await this.pool.query(
        "SELECT establishment_id FROM whatsapp_sessions WHERE status != 'disconnected'"
      );
      console.log(`[SessionManager] Found ${res.rows.length} sessions to initialize.`);

      const batchSize = 5;
      for (let i = 0; i < res.rows.length; i += batchSize) {
        const batch = res.rows.slice(i, i + batchSize);
        await Promise.all(batch.map(row => this.connect(row.establishment_id)));
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err: any) {
      console.error('[SessionManager] Error initializing active sessions:', err.message);
    }
  }

  private async updateSessionStatusDB(establishmentId: string, status: string, qrCode: string | null = null, phone: string | null = null) {
    try {
      await this.pool.query(
        `INSERT INTO whatsapp_sessions (establishment_id, status, qr_code, phone, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (establishment_id) 
         DO UPDATE SET status = EXCLUDED.status, 
                       qr_code = EXCLUDED.qr_code, 
                       phone = COALESCE(EXCLUDED.phone, whatsapp_sessions.phone),
                       updated_at = NOW()`,
        [establishmentId, status, qrCode, phone]
      );
    } catch (err) {
      console.error(`[SessionManager] Error updating session status for ${establishmentId}:`, err);
    }
  }

  public async shutdown(): Promise<void> {
    console.log('[SessionManager] Gracefully shutting down all active sessions...');
    for (const [establishmentId, sock] of this.sessions.entries()) {
      try {
        sock.end(undefined);
      } catch (e) {}
      await redisConnection.del(`lock:session:${establishmentId}`);
    }
    this.sessions.clear();
  }
}
