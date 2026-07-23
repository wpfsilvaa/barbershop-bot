import makeWASocket, { 
  DisconnectReason, 
  WASocket,
  proto,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { usePostgresAuthState } from './services/dbAuthStore';

dotenv.config();

const logger = pino({ level: 'silent' });
const BOT_SIGNATURE = '🤖*';

// Read establishment_id from Environment
const establishmentId = process.env.ESTABLISHMENT_ID;
if (!establishmentId) {
  console.error('[Error] ESTABLISHMENT_ID environment variable is missing.');
  process.exit(1);
}

// Database Connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_DATABASE || 'bot_whatsapp',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

// Cache map of discovery LID mappings
const lidToPhoneMap = new Map<string, string>();
const messageStore = new Map<string, proto.IMessage>();
const processedMessages = new Set<string>();

interface BotSession {
  state: 'IDLE' | 'ACTIVE' | 'PAUSED';
  currentNodeId: string;
  waitingForInput: boolean;
  establishmentName?: string;
  establishmentOpening?: string;
  establishmentClosing?: string;
  msg_fallback?: string;
  barbersList?: { id: string; name: string }[];
  selectedBarberId?: string;
  selectedBarberName?: string;
  datesList?: { dateStr: string; label: string }[];
  selectedDateStr?: string;
  selectedDateLabel?: string;
  slotsList?: string[];
  selectedSlotISO?: string;
  clientPushName?: string;
  activeBookingId?: string;
  lastConditionOptions?: { number: string; key: string }[];
  tempBookingsList?: any[];
}

// Memory cache to preserve non-persistent state (like temp selection lists, slots, etc.)
const botSessionsCache = new Map<string, BotSession>();

async function getOrLoadSession(phone: string): Promise<BotSession> {
  const cleanPhone = phone.split('@')[0];
  let cached = botSessionsCache.get(cleanPhone);
  
  // Query db to check if chat session exists and its state
  const res = await pool.query(
    "SELECT bot_state, current_node_id, waiting_for_input, push_name FROM whatsapp_chats WHERE establishment_id = $1 AND phone = $2",
    [establishmentId, cleanPhone]
  );

  if (res.rows.length === 0) {
    await pool.query(
      `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, current_node_id, waiting_for_input)
       VALUES ($1, $2, 'IDLE', '', false)
       ON CONFLICT (establishment_id, phone) DO NOTHING`,
      [establishmentId, cleanPhone]
    );
    const newSession: BotSession = {
      state: 'IDLE',
      currentNodeId: '',
      waitingForInput: false,
      clientPushName: 'Cliente'
    };
    botSessionsCache.set(cleanPhone, newSession);
    return newSession;
  }

  const row = res.rows[0];
  if (!cached) {
    cached = {
      state: row.bot_state as any,
      currentNodeId: row.current_node_id || '',
      waitingForInput: row.waiting_for_input,
      clientPushName: row.push_name || 'Cliente'
    };
    botSessionsCache.set(cleanPhone, cached);
  } else {
    // Sync critical states from DB in case human paused/resumed via dashboard
    cached.state = row.bot_state as any;
    cached.currentNodeId = row.current_node_id || '';
    cached.waitingForInput = row.waiting_for_input;
    cached.clientPushName = row.push_name || cached.clientPushName;
  }

  return cached;
}

async function notifyDashboard(phone: string, event: string, extra: any = {}) {
  const cleanPhone = phone.split('@')[0];
  try {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:5000';
    await fetch(`${backendUrl}/api/bot/webhook-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        establishmentId,
        event,
        phone: cleanPhone,
        ...extra
      })
    });
  } catch (err: any) {
    console.error('[WebhookNotifier] Failed to send dashboard update:', err.message);
  }
}

async function saveSession(phone: string, session: BotSession) {
  const cleanPhone = phone.split('@')[0];
  botSessionsCache.set(cleanPhone, session);
  await pool.query(
    `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, current_node_id, waiting_for_input, push_name, last_message_time)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (establishment_id, phone)
     DO UPDATE SET bot_state = EXCLUDED.bot_state,
                   current_node_id = EXCLUDED.current_node_id,
                   waiting_for_input = EXCLUDED.waiting_for_input,
                   push_name = COALESCE(EXCLUDED.push_name, whatsapp_chats.push_name),
                   last_message_time = NOW()`,
    [establishmentId, cleanPhone, session.state, session.currentNodeId, session.waitingForInput, session.clientPushName]
  );
  
  await notifyDashboard(cleanPhone, 'state_change', {
    pushName: session.clientPushName,
    state: session.state
  });
}

async function recordChatMessage(phone: string, text: string, fromMe: boolean) {
  const cleanPhone = phone.split('@')[0];
  await pool.query(
    `INSERT INTO whatsapp_messages (establishment_id, phone, message_text, from_me, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [establishmentId, cleanPhone, text, fromMe]
  );

  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  await notifyDashboard(cleanPhone, 'message', {
    message: {
      text,
      fromMe,
      time
    }
  });
}

function sanitizeMessageText(text: string): string {
  if (!text) return '';
  return text.replace(/\\n/g, '\n');
}

async function sendTextMessage(sock: WASocket, phone: string, text: string) {
  const sanitized = sanitizeMessageText(text);
  const textWithSignature = `${sanitized}\n\n${BOT_SIGNATURE}`;
  const sentMsg = await sock.sendMessage(phone, { text: textWithSignature });
  if (sentMsg?.key?.id && sentMsg?.message) {
    messageStore.set(sentMsg.key.id, sentMsg.message);
  }
  await recordChatMessage(phone, text, true);
  return sentMsg;
}

// Update local session status in db
async function updateSessionStatus(status: string, qrCode: string | null = null, phone: string | null = null) {
  try {
    await pool.query(
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
    console.error('[Database] Failed to update session status:', err);
  }
}

// JID normalize
function normalizeJid(jid: string): string {
  return jidNormalizedUser(jid);
}

async function resolveLidRetroactively(lidJid: string, phoneJid: string) {
  const lid = lidJid.split('@')[0];
  const phone = phoneJid.split('@')[0];
  try {
    await pool.query(
      `INSERT INTO lid_mappings (lid, phone) 
       VALUES ($1, $2) 
       ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone`,
      [lid, phone]
    );
    lidToPhoneMap.set(lidJid, phone);
  } catch (e) {
    console.error('[LidResolver] Failed to resolve LID retroactively:', e);
  }
}

// Recurrence plan helper
async function generateFutureBookingsForPlan(
  dbClient: any,
  estId: string,
  clientId: string,
  barberId: string,
  planType: 'quinzenal' | 'mensal',
  preferredTime: string,
  preferredDayOfWeek: number,
  serviceId?: string | null
) {
  const weeksToBook = 4;
  const now = new Date();
  
  for (let i = 0; i < weeksToBook; i++) {
    if (planType === 'quinzenal' && i % 2 !== 0) continue;
    
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + (i * 7));
    const currentDay = targetDate.getDay();
    const dayDifference = preferredDayOfWeek - currentDay;
    targetDate.setDate(targetDate.getDate() + dayDifference);
    
    if (targetDate <= now) {
      targetDate.setDate(targetDate.getDate() + 7);
    }
    
    const dateStr = targetDate.toISOString().split('T')[0];
    const appointmentTimeISO = new Date(`${dateStr}T${preferredTime}`).toISOString();
    
    const clientApptCheck = await dbClient.query(
      `SELECT id FROM appointments WHERE client_id = $1 AND appointment_time = $2 AND status != 'cancelled'`,
      [clientId, appointmentTimeISO]
    );
    if (clientApptCheck.rows.length > 0) continue;
    
    const barberCheck = await dbClient.query(
      `SELECT id FROM appointments WHERE barber_id = $1 AND appointment_time = $2 AND status != 'cancelled'`,
      [barberId, appointmentTimeISO]
    );
    if (barberCheck.rows.length > 0) continue;
    
    let finalServiceId = serviceId;
    if (!finalServiceId) {
      const serviceQuery = await dbClient.query(
        'SELECT id FROM services WHERE establishment_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1',
        [estId]
      );
      finalServiceId = serviceQuery.rows.length > 0 ? serviceQuery.rows[0].id : null;
    }

    await dbClient.query(
      `INSERT INTO appointments (establishment_id, barber_id, client_id, service_id, appointment_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
      [estId, barberId, clientId, finalServiceId, appointmentTimeISO]
    );
  }
}

// Obter e salvar a foto de perfil do contato de forma assíncrona e segura
async function fetchAndUpdateProfilePicture(sock: any, phone: string) {
  const cleanPhone = phone.split('@')[0];
  const formattedJid = `${cleanPhone}@s.whatsapp.net`;
  
  try {
    // 1. Checar se já temos a foto salva no banco de dados nas tabelas clients ou whatsapp_chats
    const chatCheck = await pool.query(
      `SELECT profile_picture_url 
       FROM whatsapp_chats 
       WHERE establishment_id = $1 AND phone = $2`,
      [establishmentId, cleanPhone]
    );

    if (chatCheck.rows.length > 0 && chatCheck.rows[0].profile_picture_url !== null) {
      return chatCheck.rows[0].profile_picture_url;
    }

    // 2. Se não estiver salva, tentamos obter do WhatsApp
    console.log(`[ProfilePicture] Fetching avatar URL for JID: ${formattedJid}`);
    let url: string | null = null;
    try {
      url = await sock.profilePictureUrl(formattedJid, 'preview');
    } catch (err: any) {
      console.log(`[ProfilePicture] Could not fetch photo for ${cleanPhone}:`, err.message);
      url = 'no-pic';
    }

    if (url) {
      // 3. Atualizar nas tabelas whatsapp_chats e clients
      await pool.query(
        `UPDATE whatsapp_chats 
         SET profile_picture_url = $1 
         WHERE establishment_id = $2 AND phone = $3`,
        [url, establishmentId, cleanPhone]
      );

      await pool.query(
        `UPDATE clients 
         SET profile_picture_url = $1 
         WHERE establishment_id = $2 AND phone = $3`,
        [url, establishmentId, cleanPhone]
      );
      
      return url;
    }
  } catch (error) {
    console.error(`[ProfilePicture] Error updating profile picture for ${cleanPhone}:`, error);
  }
  return null;
}

// Sincronização em lote de fotos de perfil pendentes
async function syncPendingProfilePictures(sock: any) {
  try {
    const res = await pool.query(
      `SELECT phone FROM clients 
       WHERE establishment_id = $1 AND (profile_picture_url IS NULL OR profile_picture_url = '')
       LIMIT 3`,
      [establishmentId]
    );

    for (const row of res.rows) {
      const cleanPhone = row.phone.replace(/\D/g, '');
      const formattedJid = `${cleanPhone}@s.whatsapp.net`;
      
      console.log(`[AvatarSync] Syncing profile picture for ${cleanPhone}...`);
      let url: string | null = null;
      try {
        url = await sock.profilePictureUrl(formattedJid, 'preview');
      } catch (err: any) {
        url = 'no-pic';
      }

      await pool.query(
        `UPDATE clients SET profile_picture_url = $1 WHERE establishment_id = $2 AND phone = $3`,
        [url, establishmentId, cleanPhone]
      );
      
      await pool.query(
        `UPDATE whatsapp_chats SET profile_picture_url = $1 WHERE establishment_id = $2 AND phone = $3`,
        [url, establishmentId, cleanPhone]
      );
      
      // Delay de 2 segundos entre consultas para evitar rate limit
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('[AvatarSync] Error running avatar sync task:', error);
  }
}

let isConnected = false;

// Core WhatsApp bootstrap
async function boot() {
  console.log(`[Worker] Starting WhatsApp connection daemon for establishment ${establishmentId}...`);
  await updateSessionStatus('connecting');

  try {
    const { state: authState, saveCreds } = await usePostgresAuthState(pool, establishmentId!);

    const sock = makeWASocket({
      auth: authState,
      printQRInTerminal: false,
      logger,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        await updateSessionStatus('qr_ready', qr);
        console.log(`[Worker] QR Code generated successfully.`);
      }

      if (connection === 'close') {
        isConnected = false;
        const error = lastDisconnect?.error as Boom;
        const statusCode = error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[Worker] Connection closed (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
        
        if (statusCode === DisconnectReason.loggedOut) {
          await pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
          await updateSessionStatus('disconnected', null, null);
          process.exit(0);
        } else {
          await updateSessionStatus('disconnected', null);
          setTimeout(() => {
            process.exit(1);
          }, 3000);
        }
      } else if (connection === 'open') {
        const phoneJid = sock.user?.id;
        const cleanPhone = phoneJid ? phoneJid.split(':')[0].split('@')[0] : null;
        console.log(`[Worker] WhatsApp connected successfully on number ${cleanPhone}!`);
        await updateSessionStatus('connected', null, cleanPhone);
        isConnected = true;
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;

      // Se for o Super Admin, ignore qualquer entrada (não responde a mensagens!)
      if (establishmentId === '00000000-0000-0000-0000-000000000000') {
        return;
      }

      // Check if establishment is active
      try {
        const estCheck = await pool.query('SELECT is_active, bot_active FROM establishments WHERE id = $1', [establishmentId]);
        if (estCheck.rows.length > 0) {
          const { is_active, bot_active } = estCheck.rows[0];
          if (!is_active) {
            console.log(`[Worker] Establishment is INACTIVE. Ignoring incoming messages.`);
            return;
          }
          if (bot_active === false) {
            console.log(`[Worker] Chatbot is disabled (bot_active = false). Ignoring message.`);
            return;
          }
        }
      } catch (err) {
        console.error('[Worker] Error checking active status:', err);
      }

      for (const msg of m.messages) {
        const msgId = msg.key?.id;
        if (msgId) {
          if (processedMessages.has(msgId)) continue;
          processedMessages.add(msgId);
          if (processedMessages.size > 2000) {
            const first = processedMessages.values().next().value;
            if (first) processedMessages.delete(first);
          }
        }

        let rawPhone = msg.key?.remoteJid;
        if (!rawPhone) continue;

        // Ignorar mensagens de grupo ou transmissões
        if (rawPhone.endsWith('@g.us') || rawPhone.endsWith('@broadcast')) {
          continue;
        }

        if (rawPhone.endsWith('@lid')) {
          const remoteJidAlt = (msg.key as any).remoteJidAlt;
          const senderPn = (msg as any).senderPn;
          if (remoteJidAlt && remoteJidAlt.endsWith('@s.whatsapp.net')) {
            rawPhone = remoteJidAlt;
          } else if (senderPn && senderPn.endsWith('@s.whatsapp.net')) {
            rawPhone = senderPn;
          }
        }

        let phone = normalizeJid(rawPhone!);
        if (phone.endsWith('@lid')) {
          const lidNumber = phone.split('@')[0];
          let mappedPhone = lidToPhoneMap.get(phone);
          if (!mappedPhone) {
            const dbMapping = await pool.query("SELECT phone FROM lid_mappings WHERE lid = $1", [lidNumber]);
            if (dbMapping.rows.length > 0) {
              mappedPhone = dbMapping.rows[0].phone;
              lidToPhoneMap.set(phone, mappedPhone!);
            }
          }
          if (mappedPhone) {
            phone = `${mappedPhone}@s.whatsapp.net`;
          }
        }

        if (msg.key?.remoteJid && msg.key.remoteJid.endsWith('@lid') && phone.endsWith('@s.whatsapp.net')) {
          const cleanLid = msg.key.remoteJid.split('@')[0];
          const cleanPhone = phone.split('@')[0];
          if (cleanLid !== cleanPhone) {
            resolveLidRetroactively(msg.key.remoteJid, phone).catch(() => {});
          }
        }

        // Tenta obter e salvar a foto de perfil de forma assíncrona
        fetchAndUpdateProfilePicture(sock, phone).catch(() => {});

        // Identificar se a mensagem veio do próprio número do bot (dono/atendente no celular físico ou outro dispositivo)
        const botPhone = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null;
        const sender = msg.participant || msg.key?.participant || '';
        const isFromMe = msg.key?.fromMe || 
                         (botPhone && sender.split('@')[0].startsWith(botPhone)) || 
                         (botPhone && msg.key?.remoteJid?.split('@')[0].startsWith(botPhone));

        if (isFromMe) {
          const text = (
            msg.message?.conversation || 
            msg.message?.extendedTextMessage?.text || 
            ''
          ).trim();
          
          if (text && !text.includes(BOT_SIGNATURE)) {
            const cleanPhone = phone.split('@')[0];
            
            // 1. Gravar no banco como from_me = true
            await pool.query(
              `INSERT INTO whatsapp_messages (establishment_id, phone, message_text, from_me, created_at)
               VALUES ($1, $2, $3, true, NOW())`,
              [establishmentId, cleanPhone, text]
            );

            // 2. Atualizar whatsapp_chats last_message_time
            await pool.query(
              `UPDATE whatsapp_chats 
               SET last_message_time = NOW()
               WHERE establishment_id = $1 AND phone = $2`,
              [establishmentId, cleanPhone]
            );

            // 3. Notificar Dashboard
            const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
            await notifyDashboard(cleanPhone, 'message', {
              message: {
                text,
                fromMe: true,
                time
              }
            });
          }
          continue; // Evita que o interpretador do bot gráfico processe mensagens de saída
        }

        // Run bot traversal engine
        await handleTenantBotFlow(sock, msg, phone);
      }
    });

    let isProcessingQueue = false;
    setInterval(async () => {
      if (!isConnected || isProcessingQueue) return;
      isProcessingQueue = true;
      try {
        const res = await pool.query(
          "SELECT * FROM whatsapp_queue WHERE establishment_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT 5",
          [establishmentId]
        );
        for (const row of res.rows) {
          try {
            console.log(`[Queue] Sending active message to JID ${row.phone}...`);
            let cleanPhone = row.phone.replace(/\D/g, '');
            let formattedJid = `${cleanPhone}@s.whatsapp.net`;

            try {
              const checkResults = await sock.onWhatsApp(formattedJid);
              if (checkResults && checkResults.length > 0 && checkResults[0].exists) {
                formattedJid = checkResults[0].jid;
              } else {
                let alternativePhone = cleanPhone;
                if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
                  alternativePhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
                } else if (cleanPhone.startsWith('55') && cleanPhone.length === 12) {
                  alternativePhone = cleanPhone.substring(0, 4) + '9' + cleanPhone.substring(4);
                }
                const alternativeJid = `${alternativePhone}@s.whatsapp.net`;
                const checkResultsAlt = await sock.onWhatsApp(alternativeJid);
                if (checkResultsAlt && checkResultsAlt.length > 0 && checkResultsAlt[0].exists) {
                  formattedJid = checkResultsAlt[0].jid;
                  console.log(`[Queue] JID resolved via alternative nono digito format: ${formattedJid}`);
                }
              }
            } catch (errCheck) {
              console.error(`[Queue] Failed checking JID existence via onWhatsApp:`, errCheck);
            }

            const finalPhoneClean = formattedJid.split('@')[0];
            const textWithSignature = `${row.message}\n\n${BOT_SIGNATURE}`;
            const sentMsg = await sock.sendMessage(formattedJid, { text: textWithSignature });
            if (sentMsg?.key?.id && sentMsg?.message) {
              messageStore.set(sentMsg.key.id, sentMsg.message);
            }
            await pool.query("UPDATE whatsapp_queue SET status = 'sent', phone = $1, updated_at = NOW() WHERE id = $2", [formattedJid, row.id]);
            
            // Log manually sent messages as well so they show in chat history!
            await recordChatMessage(finalPhoneClean, row.message, true);

            // Sincronizar foto de perfil do contato
            fetchAndUpdateProfilePicture(sock, formattedJid).catch(() => {});
          } catch (sendErr: any) {
            console.error(`[Queue] Failed to send message row ${row.id}:`, sendErr);
            await pool.query(
              "UPDATE whatsapp_queue SET status = 'failed', error_message = $1, attempts = attempts + 1, updated_at = NOW() WHERE id = $2",
              [sendErr.message || String(sendErr), row.id]
            );
          }
        }
      } catch (err) {
        console.error('[QueueScheduler] Error processing pending queue:', err);
      } finally {
        isProcessingQueue = false;
      }
    }, 1000);

    // Sincronização periódica de fotos de perfil de contatos salvos no CRM (a cada 60 segundos)
    setInterval(async () => {
      if (!isConnected) return;
      await syncPendingProfilePictures(sock);
    }, 60000);

  } catch (error) {
    console.error('[Worker] Bootstrap connection error:', error);
    process.exit(1);
  }
}

// Bot logic implementations
async function handleTenantBotFlow(sock: WASocket, msg: proto.IWebMessageInfo, phone: string) {
  if (!msg.message) return;

  let text = (
    msg.message.conversation || 
    msg.message.extendedTextMessage?.text || 
    ''
  ).trim();

  if (!text) return;
  if (text.includes(BOT_SIGNATURE) || text.includes('Atendimento Automático')) return;

  const pushName = msg.pushName || 'Cliente';
  
  // Load session from db
  const session = await getOrLoadSession(phone);
  session.clientPushName = pushName;
  
  // Record client message
  await recordChatMessage(phone, text, false);

  if (session.state === 'PAUSED') return;

  try {
    const cleanPhone = phone.split('@')[0];

    let clientCheck = await pool.query(
      'SELECT id, name FROM clients WHERE phone = $1 AND establishment_id = $2',
      [cleanPhone, establishmentId]
    );

    if (clientCheck.rows.length === 0) {
      // Check if client exists globally (registered via client portal)
      const globalClientCheck = await pool.query(
        'SELECT id, name FROM clients WHERE phone = $1 AND establishment_id IS NULL LIMIT 1',
        [cleanPhone]
      );
      if (globalClientCheck.rows.length > 0) {
        const globalClient = globalClientCheck.rows[0];
        await pool.query(
          'UPDATE clients SET establishment_id = $1 WHERE id = $2',
          [establishmentId, globalClient.id]
        );
        console.log(`[LidResolver] Associated global portal client ${globalClient.name} (${globalClient.id}) to establishment ${establishmentId}`);
        clientCheck = globalClientCheck;
      }
    }

    if (session.currentNodeId === 'register_client') {
      const clientName = text.trim();
      if (clientName.length < 3) {
        await sendTextMessage(sock, phone, '⚠️ O nome precisa ter pelo menos 3 caracteres. Por favor, digite seu nome completo:');
        return;
      }

      await pool.query(
        `INSERT INTO clients (establishment_id, name, phone)
         VALUES ($1, $2, $3)
         ON CONFLICT (establishment_id, phone) 
         DO UPDATE SET name = EXCLUDED.name`,
        [establishmentId, clientName, cleanPhone]
      );

      await sendTextMessage(sock, phone, `🎉 *Cadastro realizado com sucesso, ${clientName}!* Vamos prosseguir.`);
      session.state = 'ACTIVE';
      session.currentNodeId = 'welcome';
      session.waitingForInput = false;
      await saveSession(phone, session);
    } else if (session.currentNodeId === 'ask_promotions') {
      let option = parseInt(text, 10);
      if (isNaN(option)) {
        if (text.toLowerCase().includes('sim')) option = 1;
        else if (text.toLowerCase().includes('não') || text.toLowerCase().includes('nao')) option = 2;
      }
      if (option !== 1 && option !== 2) {
        await sendTextMessage(sock, phone, '⚠️ Opção inválida. Responda com *1* (Sim) ou *2* (Não):');
        return;
      }
      const acceptPromos = (option === 1);
      await pool.query(
        "UPDATE clients SET accept_promotions = $1 WHERE phone = $2 AND establishment_id = $3",
        [acceptPromos, cleanPhone, establishmentId]
      );
      if (acceptPromos) {
        await sendTextMessage(sock, phone, '🎉 *Que ótimo!* Você foi cadastrado na nossa lista de promoções e receberá nossas novidades em primeira mão! Obrigado! 👍');
      } else {
        await sendTextMessage(sock, phone, 'Certo! Você não receberá mensagens de promoção. Se mudar de ideia, é só nos avisar. Obrigado! 👍');
      }
      session.state = 'IDLE';
      session.currentNodeId = '';
      session.waitingForInput = false;
      await saveSession(phone, session);
      return;
    } else if (clientCheck.rows.length === 0) {
      session.state = 'ACTIVE';
      session.currentNodeId = 'register_client';
      session.waitingForInput = true;
      await sendTextMessage(sock, phone, `Olá! Seja bem-vindo! 💈\n\nIdentificamos que este é o seu primeiro contato conosco. Para continuarmos, *por favor digite seu nome completo*:`);
      await saveSession(phone, session);
      return;
    }

    if (session.currentNodeId === 'multiple_bookings_menu') {
      let option = text.toLowerCase().trim();
      const list = session.tempBookingsList || [];

      if (option === 'x' || option.includes('cancelar todos')) {
        if (list.length === 0) {
          await sendTextMessage(sock, phone, `Desculpe, ocorreu um erro ao localizar seus agendamentos.`);
          session.state = 'IDLE';
          await saveSession(phone, session);
          return;
        }
        const ids = list.map(b => b.id);
        const now = new Date();
        const targetBookings = await pool.query(
          `SELECT a.id, a.appointment_time FROM appointments a WHERE a.id = ANY($1)`,
          [ids]
        );
        let cancelledCount = 0;
        let errorCount = 0;
        for (const appt of targetBookings.rows) {
          const apptTime = new Date(appt.appointment_time);
          const diffHours = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);
          if (diffHours < 2) errorCount++;
          else {
            await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [appt.id]);
            cancelledCount++;
          }
        }
        let responseText = '';
        if (cancelledCount > 0) responseText += `✅ *${cancelledCount} agendamento(s) cancelado(s)* com sucesso.\n`;
        if (errorCount > 0) responseText += `⚠️ *${errorCount} agendamento(s)* não puderam ser cancelados (menos de 2h de antecedência).\n`;
        await sendTextMessage(sock, phone, responseText || 'Nenhum agendamento alterado.');
        session.state = 'IDLE';
        await saveSession(phone, session);
        return;
      } else if (option === 'm' || option.includes('manter')) {
        await sendTextMessage(sock, phone, `Perfeito! Seus agendamentos mantidos. Esperamos você lá! 💈`);
        session.state = 'IDLE';
        await saveSession(phone, session);
        return;
      } else {
        const index = parseInt(option, 10) - 1;
        if (!isNaN(index) && index >= 0 && index < list.length) {
          const selectedAppt = list[index];
          session.activeBookingId = selectedAppt.id;
          session.currentNodeId = 'existing_booking_menu';
          const apptTime = new Date(selectedAppt.appointment_time);
          const dateLabel = apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          const timeLabel = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          await sendTextMessage(sock, phone, `Selecionado: Horário do dia *${dateLabel}* às *${timeLabel}* com *${selectedAppt.barber_name}*.\n\n1️⃣ *Manter Agendamento*\n2️⃣ *Remarcar Horário*\n3️⃣ *Cancelar Agendamento*`);
          await saveSession(phone, session);
          return;
        }
      }
    }

    if (session.currentNodeId === 'existing_booking_menu') {
      let option = text.trim();
      if (option === '1') {
        await sendTextMessage(sock, phone, `Perfeito! Seu agendamento está confirmado! 💈`);
        session.state = 'IDLE';
        await saveSession(phone, session);
        return;
      } else if (option === '2') {
        const apptId = session.activeBookingId;
        const apptRes = await pool.query('SELECT appointment_time, id FROM appointments WHERE id = $1', [apptId]);
        if (apptRes.rows.length > 0) {
          const apptTime = new Date(apptRes.rows[0].appointment_time);
          const now = new Date();
          if ((apptTime.getTime() - now.getTime()) / (1000 * 60 * 60) < 2) {
            await sendTextMessage(sock, phone, `⚠️ *Atenção:* Não é possível remarcar com menos de 2h de antecedência.`);
            session.state = 'IDLE';
            await saveSession(phone, session);
            return;
          }
          await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [apptId]);
          await sendTextMessage(sock, phone, `Cancelamos o horário anterior. Vamos escolher um novo!`);
          session.state = 'ACTIVE';
          session.currentNodeId = 'welcome';
          session.waitingForInput = false;
          await saveSession(phone, session);
        }
      } else if (option === '3') {
        const apptId = session.activeBookingId;
        const apptRes = await pool.query('SELECT appointment_time, id FROM appointments WHERE id = $1', [apptId]);
        if (apptRes.rows.length > 0) {
          const apptTime = new Date(apptRes.rows[0].appointment_time);
          const now = new Date();
          if ((apptTime.getTime() - now.getTime()) / (1000 * 60 * 60) < 2) {
            await sendTextMessage(sock, phone, `⚠️ *Atenção:* Não é possível cancelar com menos de 2h de antecedência.`);
            session.state = 'IDLE';
            await saveSession(phone, session);
            return;
          }
          await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [apptId]);
          await sendTextMessage(sock, phone, `Cancelado com sucesso!`);
          session.state = 'IDLE';
          await saveSession(phone, session);
          return;
        }
      }
    }

    // Load Bot Flow definition
    const estRes = await pool.query('SELECT bot_flow, name, opening_time, closing_time FROM establishments WHERE id = $1', [establishmentId]);
    if (estRes.rows.length === 0) return;
    const est = estRes.rows[0];
    const botFlow = est.bot_flow;
    if (!botFlow || !botFlow.nodes) {
      console.warn('[Worker] No bot flowchart schema configured for establishment.');
      return;
    }

    session.establishmentName = est.name;
    session.establishmentOpening = est.opening_time;
    session.establishmentClosing = est.closing_time;

    const nodes: any[] = botFlow.nodes;
    const edges: any[] = botFlow.edges;
    const fallbackReply = session.msg_fallback || 'Opção inválida. Digite novamente:';

    if (session.state === 'IDLE' || !session.currentNodeId) {
      // Intercept check for existing active bookings
      const bookingsCheck = await pool.query(
        `SELECT a.id, a.appointment_time, b.name as barber_name 
         FROM appointments a 
         JOIN users b ON a.barber_id = b.id 
         WHERE a.client_id = $1 AND a.appointment_time > NOW() AND a.status != 'cancelled'
         ORDER BY a.appointment_time ASC`,
        [clientCheck.rows[0].id]
      );

      if (bookingsCheck.rows.length > 0) {
        session.tempBookingsList = bookingsCheck.rows;
        session.currentNodeId = 'multiple_bookings_menu';
        session.state = 'ACTIVE';
        session.waitingForInput = true;

        let menuText = `Olá, *${clientCheck.rows[0].name}*! Vimos que você possui agendamento(s) conosco:\n\n`;
        bookingsCheck.rows.forEach((appt, idx) => {
          const apptTime = new Date(appt.appointment_time);
          const dateLabel = apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          const timeLabel = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          menuText += `${idx + 1}️⃣ *${dateLabel} às ${timeLabel}* com *${appt.barber_name}*\n`;
        });
        menuText += `\n*Como deseja proceder?*\n\n👉 Digite o número correspondente para gerenciar aquele horário.\n👉 Digite *X* para *Cancelar Todos*.\n👉 Digite *M* para *Manter Todos* e sair.`;
        await sendTextMessage(sock, phone, menuText);
        await saveSession(phone, session);
        return;
      }

      session.state = 'ACTIVE';
      const startNode = nodes.find(n => n.type === 'start' || n.id === 'start');
      const startEdge = edges.find(e => e.source === (startNode?.id || 'start'));
      session.currentNodeId = startEdge ? startEdge.target : 'welcome';
      session.waitingForInput = false;
    }

    let loopCount = 0;
    while (loopCount < 10) {
      loopCount++;
      const node = nodes.find(n => n.id === session.currentNodeId);
      if (!node || node.type === 'end' || node.id === 'end') {
        session.state = 'IDLE';
        session.currentNodeId = '';
        session.waitingForInput = false;
        await saveSession(phone, session);
        return;
      }

      if (session.waitingForInput) {
        if (node.type === 'message') {
          const edgeToCondition = edges.find(
            e => e.source === node.id && nodes.find(n => n.id === e.target)?.type === 'condition'
          );

          if (edgeToCondition) {
            const conditionNode = nodes.find(n => n.id === edgeToCondition.target);
            let evaluatedText = text.trim();
            if (session.lastConditionOptions) {
              const matchedMap = session.lastConditionOptions.find(o => o.number === evaluatedText);
              if (matchedMap) evaluatedText = matchedMap.key;
            }

            const matchedOption = conditionNode.options?.find(
              (opt: any) => opt.key === evaluatedText || 
                            opt.key.toLowerCase() === evaluatedText.toLowerCase() ||
                            (opt.label && opt.label.toLowerCase() === evaluatedText.toLowerCase())
            );

            if (matchedOption) {
              session.currentNodeId = matchedOption.target;
              session.waitingForInput = false;
              await saveSession(phone, session);
              continue;
            } else {
              await sendTextMessage(sock, phone, fallbackReply);
              return;
            }
          }

          const directEdge = edges.find(e => e.source === node.id);
          if (directEdge) {
            session.currentNodeId = directEdge.target;
            session.waitingForInput = false;
            await saveSession(phone, session);
            continue;
          }
          session.state = 'IDLE';
          await saveSession(phone, session);
          return;
        }

        if (node.type === 'action') {
          if (node.actionType === 'select_barber') {
            let selectedBarber = null;
            if (session.barbersList) {
              const option = parseInt(text, 10);
              if (!isNaN(option) && option >= 1 && option <= session.barbersList.length) {
                selectedBarber = session.barbersList[option - 1];
              } else {
                selectedBarber = session.barbersList.find(b => b.name.toLowerCase().trim() === text.toLowerCase().trim());
              }
            }

            if (!selectedBarber) {
              await sendTextMessage(sock, phone, fallbackReply);
              return;
            }

            session.selectedBarberId = selectedBarber.id;
            session.selectedBarberName = selectedBarber.name;

            const edge = edges.find(e => e.source === node.id);
            if (edge) {
              session.currentNodeId = edge.target;
              session.waitingForInput = false;
              await saveSession(phone, session);
              continue;
            }
          }

          if (node.actionType === 'select_date') {
            let selectedDay = null;
            if (session.datesList) {
              const option = parseInt(text, 10);
              if (!isNaN(option) && option >= 1 && option <= session.datesList.length) {
                selectedDay = session.datesList[option - 1];
              } else {
                selectedDay = session.datesList.find(d => d.label.toLowerCase().trim() === text.toLowerCase().trim());
              }
            }

            if (!selectedDay) {
              await sendTextMessage(sock, phone, fallbackReply);
              return;
            }

            session.selectedDateStr = selectedDay.dateStr;
            session.selectedDateLabel = selectedDay.label;

            const edge = edges.find(e => e.source === node.id);
            if (edge) {
              session.currentNodeId = edge.target;
              session.waitingForInput = false;
              await saveSession(phone, session);
              continue;
            }
          }

          if (node.actionType === 'select_slot') {
            let selectedSlotISO = null;
            if (session.slotsList) {
              const option = parseInt(text, 10);
              if (!isNaN(option) && option >= 1 && option <= session.slotsList.length) {
                selectedSlotISO = session.slotsList[option - 1];
              } else {
                selectedSlotISO = session.slotsList.find(slotStr => formatTime(slotStr) === text.trim());
              }
            }

            if (!selectedSlotISO) {
              await sendTextMessage(sock, phone, fallbackReply);
              return;
            }

            session.selectedSlotISO = selectedSlotISO;

            // Commit Booking
            const clientDb = await pool.connect();
            try {
              await clientDb.query('BEGIN');
              let clientId = clientCheck.rows[0].id;

              const doubleBookCheck = await clientDb.query(
                `SELECT id FROM appointments WHERE barber_id = $1 AND appointment_time = $2 AND status != 'cancelled'`,
                [session.selectedBarberId, selectedSlotISO]
              );
              if (doubleBookCheck.rows.length > 0) {
                await clientDb.query('ROLLBACK');
                await sendTextMessage(sock, phone, 'Desculpe, esse horário foi reservado há poucos instantes por outro cliente. Reiniciando...');
                session.state = 'IDLE';
                await saveSession(phone, session);
                return;
              }

              const serviceQuery = await clientDb.query(
                'SELECT id FROM services WHERE establishment_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1',
                [establishmentId]
              );
              const defaultServiceId = serviceQuery.rows.length > 0 ? serviceQuery.rows[0].id : null;

              await clientDb.query(
                `INSERT INTO appointments (establishment_id, barber_id, client_id, service_id, appointment_time, status)
                 VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
                [establishmentId, session.selectedBarberId, clientId, defaultServiceId, selectedSlotISO]
              );
              await clientDb.query('COMMIT');

              const edge = edges.find(e => e.source === node.id);
              if (edge) {
                session.currentNodeId = edge.target;
                session.waitingForInput = false;
                await saveSession(phone, session);
                continue;
              }
            } catch (dbErr) {
              await clientDb.query('ROLLBACK');
              await sendTextMessage(sock, phone, 'Erro ao agendar. Tente novamente mais tarde.');
              session.state = 'IDLE';
              await saveSession(phone, session);
              return;
            } finally {
              clientDb.release();
            }
          }

          if (node.actionType === 'offer_plan') {
            let option = parseInt(text, 10);
            if (option === 1 || option === 2) {
              const planType = option === 1 ? 'quinzenal' : 'mensal';
              const clientId = clientCheck.rows[0].id;
              const slotDate = new Date(session.selectedSlotISO!);
              const preferredTime = `${String(slotDate.getHours()).padStart(2, '0')}:${String(slotDate.getMinutes()).padStart(2, '0')}:00`;
              const preferredDayOfWeek = slotDate.getDay();

              const clientDb = await pool.connect();
              try {
                await clientDb.query('BEGIN');
                await clientDb.query(
                  `INSERT INTO client_plans (establishment_id, client_id, barber_id, plan_type, preferred_time, preferred_day_of_week, is_active)
                   VALUES ($1, $2, $3, $4, $5, $6, true)
                   ON CONFLICT (client_id, establishment_id)
                   DO UPDATE SET plan_type = EXCLUDED.plan_type, preferred_time = EXCLUDED.preferred_time, preferred_day_of_week = EXCLUDED.preferred_day_of_week`,
                  [establishmentId, clientId, session.selectedBarberId, planType, preferredTime, preferredDayOfWeek]
                );
                await generateFutureBookingsForPlan(clientDb, establishmentId!, clientId, session.selectedBarberId!, planType, preferredTime, preferredDayOfWeek);
                await clientDb.query('COMMIT');
                await sendTextMessage(sock, phone, `🎉 *Excelente!* Seu Plano *${planType === 'quinzenal' ? 'Quinzenal' : 'Mensal'}* foi ativo e seus próximos horários já estão reservados! 👍`);
              } catch (e) {
                await clientDb.query('ROLLBACK');
                console.error(e);
              } finally {
                clientDb.release();
              }
            } else if (option === 3) {
              await sendTextMessage(sock, phone, 'Perfeito! Esperamos você no dia marcado. Obrigado!');
            } else {
              await sendTextMessage(sock, phone, 'Opção inválida. Responda 1 (Quinzenal), 2 (Mensal) ou 3 (Não).');
              return;
            }

            session.state = 'ACTIVE';
            session.currentNodeId = 'ask_promotions';
            session.waitingForInput = true;
            await saveSession(phone, session);
            await sendTextMessage(sock, phone, `📲 *Última pergunta:* Gostaria de receber promoções exclusivas da nossa barbearia pelo WhatsApp?\n\n1️⃣ *Sim, por favor!*\n2️⃣ *Não, obrigado.*`);
            return;
          }
        }
      }

      // Presenting prompts
      if (!session.waitingForInput) {
        if (node.type === 'message') {
          const replaced = replacePlaceholders(node.text || '', {
            cliente: pushName,
            estabelecimento: session.establishmentName,
            abertura: session.establishmentOpening,
            fechamento: session.establishmentClosing,
            barbeiro: session.selectedBarberName,
            horario: session.selectedSlotISO ? formatTime(session.selectedSlotISO) : undefined,
            data: session.selectedDateLabel
          });

          const edgeToCondition = edges.find(
            e => e.source === node.id && nodes.find(n => n.id === e.target)?.type === 'condition'
          );

          if (edgeToCondition) {
            const conditionNode = nodes.find(n => n.id === edgeToCondition.target);
            if (conditionNode && conditionNode.options && conditionNode.options.length > 0) {
              let menuText = replaced + '\n';
              conditionNode.options.forEach((opt: any, idx: number) => {
                menuText += `\n*${idx + 1}* - ${opt.label || opt.key}`;
              });
              menuText += '\n\n_Por favor, responda apenas com o número correspondente._';
              await sendTextMessage(sock, phone, menuText);
              session.lastConditionOptions = conditionNode.options.map((opt: any, idx: number) => ({
                number: String(idx + 1),
                key: opt.key
              }));
              session.waitingForInput = true;
              await saveSession(phone, session);
              return;
            }
          }

          await sendTextMessage(sock, phone, replaced);
          const directEdge = edges.find(e => e.source === node.id);
          if (directEdge) {
            session.currentNodeId = directEdge.target;
            await saveSession(phone, session);
            continue;
          }
          session.state = 'IDLE';
          await saveSession(phone, session);
          return;
        }

        if (node.type === 'api') {
          const method = node.method || 'POST';
          const urlTemplate = node.url || '';
          const headersTemplate = node.headers || '{}';
          const bodyTemplate = node.body || '{}';
          const responseTemplate = node.webhookResponse || '';

          const vars = {
            cliente: pushName,
            estabelecimento: session.establishmentName,
            abertura: session.establishmentOpening,
            fechamento: session.establishmentClosing,
            barbeiro: session.selectedBarberName || '',
            horario: session.selectedSlotISO ? formatTime(session.selectedSlotISO) : '',
            data: session.selectedDateLabel || ''
          };

          const resolvedUrl = replacePlaceholders(urlTemplate, vars);
          const resolvedHeadersStr = replacePlaceholders(headersTemplate, vars);
          const resolvedBodyStr = replacePlaceholders(bodyTemplate, vars);

          console.log(`[WebhookNode] Executing ${method} call to ${resolvedUrl}...`);
          try {
            let headers = {};
            try {
              headers = JSON.parse(resolvedHeadersStr);
            } catch (e) {
              console.warn('[WebhookNode] Failed to parse headers JSON, using empty headers:', e);
            }

            let requestOptions: any = {
              method,
              headers: {
                'Content-Type': 'application/json',
                ...headers
              }
            };
            if (method !== 'GET' && method !== 'HEAD') {
              requestOptions.body = resolvedBodyStr;
            }

            const response = await fetch(resolvedUrl, requestOptions);
            console.log(`[WebhookNode] API response status: ${response.status}`);

            if (responseTemplate) {
              const resolvedResponseText = replacePlaceholders(responseTemplate, vars);
              await sendTextMessage(sock, phone, resolvedResponseText);
            }
          } catch (apiErr) {
            console.error('[WebhookNode] API call failed:', apiErr);
          }

          const edge = edges.find(e => e.source === node.id);
          if (edge) {
            session.currentNodeId = edge.target;
            session.waitingForInput = false;
            await saveSession(phone, session);
            continue;
          }
          session.state = 'IDLE';
          await saveSession(phone, session);
          return;
        }

        if (node.type === 'condition') {
          session.currentNodeId = 'welcome';
          await saveSession(phone, session);
          continue;
        }

        if (node.type === 'action') {
          if (node.actionType === 'select_barber') {
            const barbersRes = await pool.query(
              `SELECT id, name FROM users WHERE establishment_id = $1 AND role = 'barber' AND is_active = true ORDER BY name ASC`,
              [establishmentId]
            );

            if (barbersRes.rows.length === 0) {
              await sendTextMessage(sock, phone, 'Desculpe, no momento não temos profissionais cadastrados.');
              session.state = 'IDLE';
              await saveSession(phone, session);
              return;
            }

            session.barbersList = barbersRes.rows;
            const templateText = est.msg_select_barber || 'Escolha o profissional:';
            const titleText = replacePlaceholders(templateText, { barbeiros: '' }).replace(/\n+/g, '\n').trim();

            let menuText = `💈 ${titleText || 'Escolha o profissional:'}\n`;
            barbersRes.rows.forEach((b, idx) => {
              menuText += `\n*${idx + 1}* - ${b.name}`;
            });
            menuText += '\n\n_Por favor, responda apenas com o número desejado (ex: 1)._';

            await sendTextMessage(sock, phone, menuText);
            session.waitingForInput = true;
            await saveSession(phone, session);
            return;
          }

          if (node.actionType === 'select_date') {
            const nextDays = getNextWorkingDays(5);
            session.datesList = nextDays;

            const templateText = est.msg_select_date || 'Para qual dia deseja agendar?';
            const titleText = replacePlaceholders(templateText, { datas: '' }).replace(/\n+/g, '\n').trim();

            let menuText = `📅 ${titleText || 'Para qual dia deseja agendar?'}\n`;
            nextDays.forEach((d, idx) => {
              menuText += `\n*${idx + 1}* - ${d.label}`;
            });
            menuText += '\n\n_Por favor, responda apenas com o número desejado (ex: 1)._';

            await sendTextMessage(sock, phone, menuText);
            session.waitingForInput = true;
            await saveSession(phone, session);
            return;
          }

          if (node.actionType === 'select_slot') {
            const estResInfo = await pool.query(
              'SELECT opening_time, closing_time, slot_duration_minutes FROM establishments WHERE id = $1',
              [establishmentId]
            );
            const { opening_time, closing_time, slot_duration_minutes } = estResInfo.rows[0];

            const appRes = await pool.query(
              `SELECT appointment_time FROM appointments WHERE barber_id = $1 AND DATE(appointment_time AT TIME ZONE 'UTC') = $2 AND status != 'cancelled'`,
              [session.selectedBarberId, session.selectedDateStr]
            );

            const bookedTimes = appRes.rows.map((row) => new Date(row.appointment_time).getTime());

            // Generate slots
            const allSlots: Date[] = [];
            const [openHour, openMin] = opening_time.split(':').map(Number);
            const [closeHour, closeMin] = closing_time.split(':').map(Number);

            const targetDateObj = new Date(session.selectedDateStr + 'T00:00:00');
            const startSlot = new Date(targetDateObj);
            startSlot.setHours(openHour, openMin, 0, 0);

            const endSlot = new Date(targetDateObj);
            endSlot.setHours(closeHour, closeMin, 0, 0);

            const now = new Date();
            let current = new Date(startSlot);

            while (current < endSlot) {
              if (current > now && !bookedTimes.includes(current.getTime())) {
                allSlots.push(new Date(current));
              }
              current.setMinutes(current.getMinutes() + slot_duration_minutes);
            }

            if (allSlots.length === 0) {
              await sendTextMessage(sock, phone, `Desculpe, sem horários livres para ${session.selectedBarberName} no dia ${session.selectedDateLabel}. Digite outra data para tentar novamente:`);
              session.currentNodeId = 'select_date';
              session.waitingForInput = false;
              await saveSession(phone, session);
              continue;
            }

            session.slotsList = allSlots.map(d => d.toISOString());
            const templateText = est.msg_select_slot || 'Escolha o horário:';
            const titleText = replacePlaceholders(templateText, { horarios: '' }).replace(/\n+/g, '\n').trim();

            let menuText = `⏰ ${titleText || 'Escolha o horário:'}\n`;
            allSlots.forEach((slot, idx) => {
              menuText += `\n*${idx + 1}* - ${formatTime(slot.toISOString())}`;
            });
            menuText += '\n\n_Por favor, responda apenas com o número desejado (ex: 1)._';

            await sendTextMessage(sock, phone, menuText);
            session.waitingForInput = true;
            await saveSession(phone, session);
            return;
          }

          if (node.actionType === 'offer_plan') {
            const cleanPhone = phone.split('@')[0];
            const planCheck = await pool.query(
              `SELECT p.plan_type FROM client_plans p JOIN clients c ON p.client_id = c.id WHERE c.phone = $1 AND p.establishment_id = $2 AND p.is_active = true`,
              [cleanPhone, establishmentId]
            );

            if (planCheck.rows.length > 0) {
              const activePlan = planCheck.rows[0].plan_type;
              await sendTextMessage(sock, phone, `Perfeito! Como você já possui o plano *${activePlan === 'quinzenal' ? 'Quinzenal' : 'Mensal'}* ativo, seus próximos horários já estão reservados! Obrigado! 💈`);
              const edge = edges.find(e => e.source === node.id);
              if (edge) {
                session.currentNodeId = edge.target;
                session.waitingForInput = false;
                await saveSession(phone, session);
                continue;
              } else {
                session.state = 'IDLE';
                await saveSession(phone, session);
                return;
              }
            }

            const menuText = `💈 *Clube de Assinatura*\n\nGostaria de aderir a um plano recorrente para garantir seu corte sempre no mesmo dia e horário?\n\n1️⃣ *Plano Quinzenal*\n2️⃣ *Plano Mensal*\n3️⃣ *Não, obrigado*`;
            await sendTextMessage(sock, phone, menuText);
            session.waitingForInput = true;
            await saveSession(phone, session);
            return;
          }
        }
      }
    }
  } catch (error) {
    console.error('[Worker] Bot Engine traversal error:', error);
    session.state = 'IDLE';
    await saveSession(phone, session);
  }
}

// Sub Helpers
function replacePlaceholders(template: string, vars: any): string {
  let res = template;
  if (vars.cliente) res = res.replace(/{cliente}/g, vars.cliente);
  if (vars.estabelecimento) res = res.replace(/{estabelecimento}/g, vars.estabelecimento);
  if (vars.abertura) res = res.replace(/{abertura}/g, formatTime(vars.abertura));
  if (vars.fechamento) res = res.replace(/{fechamento}/g, formatTime(vars.fechamento));
  if (vars.barbeiro) res = res.replace(/{barbeiro}/g, vars.barbeiro);
  if (vars.horario) res = res.replace(/{horario}/g, vars.horario);
  if (vars.data) res = res.replace(/{data}/g, vars.data);
  return res;
}

function formatTime(isoOrTime: string): string {
  if (!isoOrTime) return '';
  if (isoOrTime.includes('T')) {
    const d = new Date(isoOrTime);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  }
  return isoOrTime.substring(0, 5);
}

function getNextWorkingDays(daysCount: number): { dateStr: string; label: string }[] {
  const days: { dateStr: string; label: string }[] = [];
  const now = new Date();
  let checked = 0;
  
  while (days.length < daysCount && checked < 15) {
    checked++;
    const target = new Date(now);
    target.setDate(now.getDate() + checked);
    if (target.getDay() === 0) continue;
    const dateStr = target.toISOString().split('T')[0];
    const label = target.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' });
    days.push({
      dateStr,
      label: label.charAt(0).toUpperCase() + label.slice(1)
    });
  }
  return days;
}

// Start Boot
boot();
