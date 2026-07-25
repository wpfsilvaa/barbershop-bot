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
const BOT_SIGNATURE = '🤖';

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
  private heartbeats = new Map<string, NodeJS.Timeout>();
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
  //
  // A versão anterior fazia um SET incondicional e retornava `true` sempre: o
  // "lock distribuído" só sobrescrevia o dono anterior. Com duas réplicas do
  // gateway, ambas abriam a mesma sessão Baileys com as mesmas credenciais, o que
  // faz o WhatsApp invalidar a sessão e derrubar o bot da barbearia. `NX` torna a
  // aquisição realmente exclusiva.
  private async acquireSessionLock(establishmentId: string): Promise<boolean> {
    const lockKey = `lock:session:${establishmentId}`;
    const result = await redisConnection.set(lockKey, this.instanceId, 'EX', 30, 'NX');

    if (result === 'OK') return true;

    // Reentrância: se o lock já é desta instância, seguimos em frente.
    const owner = await redisConnection.get(lockKey);
    return owner === this.instanceId;
  }

  private async refreshSessionLock(establishmentId: string): Promise<void> {
    const lockKey = `lock:session:${establishmentId}`;
    // Só renova se ainda formos o dono — evita estender o lock de outra instância.
    const owner = await redisConnection.get(lockKey);
    if (owner === this.instanceId) {
      await redisConnection.expire(lockKey, 30);
    }
  }

  /** Encerra o heartbeat de renovação do lock de uma sessão. */
  private clearHeartbeat(establishmentId: string): void {
    const timer = this.heartbeats.get(establishmentId);
    if (timer) {
      clearInterval(timer);
      this.heartbeats.delete(establishmentId);
    }
  }

  /** Libera o lock apenas se ele ainda pertencer a esta instância. */
  private async releaseSessionLock(establishmentId: string): Promise<void> {
    const lockKey = `lock:session:${establishmentId}`;
    const owner = await redisConnection.get(lockKey);
    if (owner === this.instanceId) {
      await redisConnection.del(lockKey);
    }
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
      this.clearHeartbeat(establishmentId);
    }

    // Libera apenas o lock desta instância. O `del` incondicional anterior
    // roubava o lock de outra réplica e anulava a exclusividade.
    await this.releaseSessionLock(establishmentId);

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
              this.clearHeartbeat(establishmentId);
              this.sessionStatuses.set(establishmentId, 'DISCONNECTED');
              await this.pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
              await this.updateSessionStatusDB(establishmentId, 'disconnected', null, null);
              await this.releaseSessionLock(establishmentId);
            }
          }, 60000);
        }

        if (connection === 'close') {
          this.sessions.delete(establishmentId);
          this.clearHeartbeat(establishmentId);
          if ((sock as any)._qrTimer) clearTimeout((sock as any)._qrTimer);
          await this.releaseSessionLock(establishmentId);

          const error = lastDisconnect?.error as Boom;
          const statusCode = error?.output?.statusCode;
          const currentStatus = this.sessionStatuses.get(establishmentId);
          this.sessionStatuses.set(establishmentId, 'DISCONNECTED');

          console.log(`[SessionManager] Connection closed for ${establishmentId} (Status: ${statusCode}, PrevState: ${currentStatus}).`);

          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

          if (isRestartRequired) {
            console.log(`[SessionManager] QR Code scanned / Restart required for ${establishmentId}. Reconnecting with saved credentials...`);
            await this.updateSessionStatusDB(establishmentId, 'connecting', null);
            setTimeout(() => this.connect(establishmentId), 1000);
          } else if (isLoggedOut) {
            console.log(`[SessionManager] Logged out for establishment ${establishmentId}. Cleaning credentials...`);
            await this.pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
            await this.updateSessionStatusDB(establishmentId, 'disconnected', null, null);
          } else {
            await this.updateSessionStatusDB(establishmentId, 'disconnected', null);
            if (currentStatus === 'CONNECTED' || currentStatus === 'QR_READY' || currentStatus === 'CONNECTING') {
              setTimeout(() => this.connect(establishmentId), 3000);
            }
          }
        } else if (connection === 'open') {
          const phoneJid = sock.user?.id;
          const cleanPhone = phoneJid ? phoneJid.split(':')[0].split('@')[0] : null;

          this.sessions.set(establishmentId, sock);
          this.sessionStatuses.set(establishmentId, 'CONNECTED');
          console.log(`[SessionManager] Establishment ${establishmentId} CONNECTED on phone ${cleanPhone}!`);

          await this.updateSessionStatusDB(establishmentId, 'connected', null, cleanPhone);

          // Refresh lock heartbeat.
          //
          // Este `setInterval` nunca era guardado nem limpo: cada reconexão criava
          // mais um timer eterno. Depois de algumas horas de instabilidade de rede,
          // dezenas deles martelavam o Redis em paralelo e o processo nunca
          // conseguia encerrar de forma limpa.
          this.clearHeartbeat(establishmentId);
          const heartbeat = setInterval(() => {
            this.refreshSessionLock(establishmentId).catch((err) =>
              console.error(`[SessionManager] Heartbeat failed for ${establishmentId}:`, err.message)
            );
          }, 10000);
          heartbeat.unref?.();
          this.heartbeats.set(establishmentId, heartbeat);
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

          const cleanPhone = await this.resolveCanonicalPhone(establishmentId, rawPhone);
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
        if ((sock as any)._qrTimer) clearTimeout((sock as any)._qrTimer);
        sock.end(undefined);
      } catch (e) {}
      this.sessions.delete(establishmentId);
      this.sessionStatuses.set(establishmentId, 'DISCONNECTED');
    }
    this.clearHeartbeat(establishmentId);
    await this.pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
    await this.updateSessionStatusDB(establishmentId, 'disconnected', null, null);
    await this.releaseSessionLock(establishmentId);
  }

  // O Baileys 7 entrega mensagens endereçadas por LID (`<id>@lid`), não pelo número
  // de telefone. Como o identificador do LID é só dígitos, o resto do sistema o
  // tratava como se fosse um telefone e remontava `<lid>@s.whatsapp.net` na hora de
  // responder — um JID que não existe. O WhatsApp aceitava e descartava em silêncio,
  // então o bot gravava a resposta no histórico mas nada chegava ao celular.
  //
  // O próprio auth store do Baileys guarda o mapeamento (`lid-mapping`), então dá
  // para distinguir LID de telefone com um dado real em vez de heurística de
  // tamanho: se existe `<id>_reverse`, o identificador é um LID.
  private async resolveCanonicalPhone(establishmentId: string, remoteJid: string): Promise<string> {
    let digits = remoteJid.split('@')[0].replace(/\D/g, '');

    const isLid = remoteJid.endsWith('@lid') || (!digits.startsWith('55') && digits.length >= 13);

    if (isLid) {
      // 1. Check lid_mappings table FIRST
      try {
        const globalRes = await this.pool.query(
          `SELECT phone FROM lid_mappings WHERE lid = $1`,
          [digits]
        );
        if (globalRes.rows.length > 0 && globalRes.rows[0].phone) {
          let mappedPhone = globalRes.rows[0].phone.replace(/\D/g, '');
          if (mappedPhone.startsWith('55') && mappedPhone.length === 12) {
            mappedPhone = mappedPhone.substring(0, 4) + '9' + mappedPhone.substring(4);
          }
          return mappedPhone;
        }
      } catch (err) {}

      // 2. Check whatsapp_auth_states table
      try {
        const res = await this.pool.query(
          `SELECT key_data FROM whatsapp_auth_states
           WHERE establishment_id = $1 AND key_type = 'lid-mapping' AND key_id = $2`,
          [establishmentId, `${digits}_reverse`]
        );
        if (res.rows.length > 0) {
          let realPhone = res.rows[0].key_data;
          if (typeof realPhone === 'string') realPhone = realPhone.replace(/"/g, '');
          if (realPhone) {
            let cleanReal = realPhone.replace(/\D/g, '');
            if (cleanReal.startsWith('55') && cleanReal.length === 12) {
              cleanReal = cleanReal.substring(0, 4) + '9' + cleanReal.substring(4);
            }
            await this.pool.query(
              `INSERT INTO lid_mappings (lid, phone, updated_at) VALUES ($1, $2, NOW())
               ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW()`,
              [digits, cleanReal]
            );
            return cleanReal;
          }
        }
      } catch (err) {}
    }

    if (digits.startsWith('55') && digits.length === 12) {
      digits = digits.substring(0, 4) + '9' + digits.substring(4);
    }

    return digits;
  }

  private async resolveLidJid(establishmentId: string, digits: string): Promise<string | null> {
    try {
      const res = await this.pool.query(
        `SELECT key_data FROM whatsapp_auth_states
          WHERE establishment_id = $1 AND key_type = 'lid-mapping' AND key_id = $2`,
        [establishmentId, `${digits}_reverse`]
      );
      if (res.rows.length === 0) return null;

      return `${digits}@lid`;
    } catch (err: any) {
      console.error(`[SessionManager] LID lookup failed for ${digits}:`, err.message);
      return null;
    }
  }

  public async sendMessage(establishmentId: string, phone: string, text: string, isManual: boolean = false): Promise<boolean> {
    const sock = this.sessions.get(establishmentId);
    if (!sock) {
      console.error(`[SessionManager] Outbound message failed. No active session for establishment ${establishmentId}.`);
      return false;
    }

    let cleanPhone = phone.replace(/\D/g, '');
    let targetJid: string | null = null;

    if (phone.includes('@')) {
      const normalized = jidNormalizedUser(phone);
      const domain = normalized.split('@')[1];
      if (domain === 's.whatsapp.net' || domain === 'lid') {
        targetJid = normalized;
      } else {
        console.error(`[SessionManager] Refusing outbound message to unsupported JID domain '${domain}' (Tenant: ${establishmentId}).`);
        return false;
      }
    }

    const variations: string[] = [cleanPhone];
    if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
      variations.push(cleanPhone.substring(0, 4) + cleanPhone.substring(5));
    } else if (cleanPhone.startsWith('55') && cleanPhone.length === 12) {
      variations.push(cleanPhone.substring(0, 4) + '9' + cleanPhone.substring(4));
    }

    // 1. Check lid_mappings table FIRST for mapped LID JID
    if (!targetJid) {
      try {
        const lidMapRes = await this.pool.query(
          `SELECT lid FROM lid_mappings WHERE phone = ANY($1) OR lid = $2 LIMIT 1`,
          [variations, cleanPhone]
        );
        if (lidMapRes.rows.length > 0 && lidMapRes.rows[0].lid) {
          targetJid = `${lidMapRes.rows[0].lid}@lid`;
          console.log(`[SessionManager] Found mapped LID JID for ${cleanPhone}: ${targetJid}`);
        }
      } catch (err) {}
    }

    // 2. Check whatsapp_auth_states table
    if (!targetJid) {
      try {
        const lidRes = await this.pool.query(
          `SELECT key_data FROM whatsapp_auth_states
           WHERE establishment_id = $1 AND key_type = 'lid-mapping' AND key_id = ANY($2)`,
          [establishmentId, variations]
        );
        if (lidRes.rows.length > 0) {
          let lidVal = lidRes.rows[0].key_data;
          if (typeof lidVal === 'string') lidVal = lidVal.replace(/"/g, '');
          if (lidVal) {
            targetJid = `${lidVal}@lid`;
            console.log(`[SessionManager] Found auth_states LID JID for ${cleanPhone}: ${targetJid}`);
          }
        }
      } catch (err) {}
    }

    // 3. Direct 13-digit Brazilian phone JID
    if (!targetJid) {
      if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
        targetJid = `${cleanPhone}@s.whatsapp.net`;
      }
    }

    // 4. Query official WhatsApp server via sock.onWhatsApp FIRST for other numbers
    if (!targetJid) {
      for (const variant of variations) {
        try {
          const results = await sock.onWhatsApp(variant);
          if (results && results.length > 0 && results[0]?.exists) {
            targetJid = results[0].jid;
            console.log(`[SessionManager] onWhatsApp verified JID for ${variant}: ${targetJid}`);
            break;
          }
        } catch (err: any) {
          console.warn(`[SessionManager] onWhatsApp query failed for ${variant}:`, err.message);
        }
      }
    }

    // 5. Fallback: check global lid_mappings table
    if (!targetJid) {
      try {
        const globalRes = await this.pool.query(
          `SELECT lid FROM lid_mappings WHERE lid = $1`,
          [cleanPhone]
        );
        if (globalRes.rows.length > 0 && globalRes.rows[0].lid) {
          targetJid = `${globalRes.rows[0].lid}@lid`;
        }
      } catch (err) {}
    }

    // 6. Default fallback: direct @s.whatsapp.net
    if (!targetJid) {
      targetJid = `${cleanPhone}@s.whatsapp.net`;
    }

    console.log(`[SessionManager] Sending outbound message to ${targetJid} (Tenant: ${establishmentId}, isManual: ${isManual})...`);

    const textWithSignature = isManual ? text : `${text}\n\n${BOT_SIGNATURE}`;
    const sent = await sock.sendMessage(targetJid, { text: textWithSignature });

    if (!sent?.key?.id) {
      console.error(`[SessionManager] WhatsApp did not acknowledge message to ${targetJid} (Tenant: ${establishmentId}).`);
      return false;
    }

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
        if ((sock as any)._qrTimer) clearTimeout((sock as any)._qrTimer);
        sock.end(undefined);
      } catch (e) {}
      this.clearHeartbeat(establishmentId);
      await this.releaseSessionLock(establishmentId);
    }
    this.sessions.clear();
    this.heartbeats.clear();
  }
}
