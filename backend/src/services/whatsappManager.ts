import pool from '../config/db';
import { outboundQueue, redisConnection } from '../config/redis';
import { normalizePhone } from '../utils/phone';

// -------------------------------------------------------------
// WhatsApp Session Orchestration (Redis Pub/Sub Driven)
// -------------------------------------------------------------
export async function startWhatsAppSession(establishmentId: string) {
  console.log(`[SessionOrchestrator] Requesting start for WhatsApp session: ${establishmentId}...`);

  try {
    // Update DB status to connecting
    await pool.query(
      `INSERT INTO whatsapp_sessions (establishment_id, status, updated_at)
       VALUES ($1, 'connecting', NOW())
       ON CONFLICT (establishment_id) DO UPDATE SET status = 'connecting', updated_at = NOW()`,
      [establishmentId]
    );

    // Publish event via Redis so WhatsApp Gateway instance connects this session
    await redisConnection.publish('session:command', JSON.stringify({ action: 'start', establishmentId }));
  } catch (err: any) {
    console.error(`[SessionOrchestrator] Failed to start session for ${establishmentId}:`, err.message);
  }
}

export async function disconnectWhatsAppSession(establishmentId: string) {
  console.log(`[SessionOrchestrator] Requesting disconnect for WhatsApp session: ${establishmentId}...`);

  try {
    // Publish event via Redis so WhatsApp Gateway closes session and cleans keys
    await redisConnection.publish('session:command', JSON.stringify({ action: 'disconnect', establishmentId }));

    // Clean credentials and session status in DB
    await pool.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
    await pool.query(
      `INSERT INTO whatsapp_sessions (establishment_id, status, qr_code, phone, updated_at)
       VALUES ($1, 'disconnected', null, null, NOW())
       ON CONFLICT (establishment_id) 
       DO UPDATE SET status = 'disconnected', qr_code = null, phone = null, updated_at = NOW()`,
      [establishmentId]
    );
  } catch (err: any) {
    console.error(`[SessionOrchestrator] Failed to disconnect session for ${establishmentId}:`, err.message);
  }
}

export async function initializeAllWhatsAppSessions() {
  console.log('[SessionOrchestrator] Signal sent to boot active WhatsApp sessions...');
  try {
    const res = await pool.query(
      "SELECT establishment_id FROM whatsapp_sessions WHERE status != 'disconnected'"
    );
    for (const row of res.rows) {
      await startWhatsAppSession(row.establishment_id);
    }
  } catch (err: any) {
    console.error('[SessionOrchestrator] Session boot initialization failed:', err.message);
  }
}

// -------------------------------------------------------------
// Message Outbound Queue Operations (BullMQ Push)
// -------------------------------------------------------------
export async function sendOrchestratedMessage(establishmentId: string, phone: string, text: string): Promise<boolean> {
  try {
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      console.error('[QueueOperations] Telefone inválido descartado na fila de saída.');
      return false;
    }

    await outboundQueue.add('send-whatsapp-message', {
      establishmentId,
      phone: cleanPhone,
      text,
    });
    return true;
  } catch (err) {
    console.error('[QueueOperations] Failed to push outbound orchestrated message to BullMQ:', err);
    return false;
  }
}

export async function sendManualMessage(
  establishmentId: string,
  phone: string,
  text: string,
  senderUser?: { id: string; name: string }
): Promise<string> {
  let cleanPhone = normalizePhone(phone);

  try {
    const lidRes = await pool.query(
      `SELECT phone FROM lid_mappings WHERE lid = $1`,
      [cleanPhone]
    );
    if (lidRes.rows.length > 0 && lidRes.rows[0].phone) {
      cleanPhone = lidRes.rows[0].phone;
    }
  } catch (e) {}

  if (!cleanPhone) {
    throw new Error('Telefone de destino inválido.');
  }

  const formattedJid = `${cleanPhone}@s.whatsapp.net`;

  // 1. Queue outbound message in BullMQ
  await outboundQueue.add('send-whatsapp-message', {
    establishmentId,
    phone: cleanPhone,
    text,
    isManual: true,
  });

  // 2. Automatically pause bot session AND assign agent to this chat
  if (senderUser?.id) {
    await pool.query(
      `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, assigned_agent_id, assigned_agent_name, last_message_time)
       VALUES ($1, $2, 'PAUSED', $3, $4, NOW())
       ON CONFLICT (establishment_id, phone) DO UPDATE SET 
         bot_state = 'PAUSED',
         assigned_agent_id = EXCLUDED.assigned_agent_id,
         assigned_agent_name = EXCLUDED.assigned_agent_name,
         last_message_time = NOW()`,
      [establishmentId, cleanPhone, senderUser.id, senderUser.name]
    );
  } else {
    await pool.query(
      `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, last_message_time)
       VALUES ($1, $2, 'PAUSED', NOW())
       ON CONFLICT (establishment_id, phone) DO UPDATE SET bot_state = 'PAUSED', last_message_time = NOW()`,
      [establishmentId, cleanPhone]
    );
  }

  return formattedJid;
}

// -------------------------------------------------------------
// Chat Control Panel Operations
// -------------------------------------------------------------
export async function pauseChatBot(establishmentId: string, phone: string) {
  const cleanPhone = phone.replace(/\D/g, '');
  await pool.query(
    `UPDATE whatsapp_chats SET bot_state = 'PAUSED' WHERE establishment_id = $1 AND phone = $2`,
    [establishmentId, cleanPhone]
  );
  try {
    await redisConnection.publish('whatsapp-chat-updates', JSON.stringify({
      establishmentId,
      phone: cleanPhone,
      action: 'pause'
    }));
  } catch (e) {}
}

export async function resumeChatBot(establishmentId: string, phone: string) {
  const cleanPhone = phone.replace(/\D/g, '');
  await pool.query(
    `UPDATE whatsapp_chats SET bot_state = 'ACTIVE', current_node_id = 'welcome', waiting_for_input = false, assigned_agent_id = NULL, assigned_agent_name = NULL WHERE establishment_id = $1 AND phone = $2`,
    [establishmentId, cleanPhone]
  );
  try {
    await redisConnection.publish('whatsapp-chat-updates', JSON.stringify({
      establishmentId,
      phone: cleanPhone,
      action: 'resume'
    }));
  } catch (e) {}
}

export async function terminateChatSession(establishmentId: string, phone: string) {
  const cleanPhone = phone.replace(/\D/g, '');
  await pool.query(
    `UPDATE whatsapp_chats SET bot_state = 'IDLE', current_node_id = '', waiting_for_input = false, assigned_agent_id = NULL, assigned_agent_name = NULL, last_message_time = NOW() WHERE establishment_id = $1 AND phone = $2`,
    [establishmentId, cleanPhone]
  );
  await pool.query(
    `UPDATE whatsapp_messages SET is_archived = true WHERE establishment_id = $1 AND phone = $2 AND is_archived = false`,
    [establishmentId, cleanPhone]
  );
  try {
    await redisConnection.publish('whatsapp-chat-updates', JSON.stringify({
      establishmentId,
      phone: cleanPhone,
      action: 'terminate'
    }));
  } catch (e) {}
}

export async function transferChatSession(
  establishmentId: string,
  phone: string,
  targetAgentId: string,
  targetAgentName: string,
  transferredByAgentName: string
) {
  let cleanPhone = normalizePhone(phone);
  try {
    const lidRes = await pool.query(`SELECT phone FROM lid_mappings WHERE lid = $1`, [cleanPhone]);
    if (lidRes.rows.length > 0 && lidRes.rows[0].phone) cleanPhone = lidRes.rows[0].phone;
  } catch (e) {}

  if (!cleanPhone) throw new Error('Telefone de destino inválido.');

  // 1. Update chat state to PAUSED and assign to target agent
  await pool.query(
    `UPDATE whatsapp_chats 
     SET bot_state = 'PAUSED', 
         assigned_agent_id = $1, 
         assigned_agent_name = $2, 
         last_message_time = NOW() 
     WHERE establishment_id = $3 AND phone = $4`,
    [targetAgentId, targetAgentName, establishmentId, cleanPhone]
  );

  // 2. Build transfer notice message text
  const transferNoticeText = `🔄 *Atendimento Transferido*\n\nSeu atendimento foi transferido por *${transferredByAgentName}* para o profissional *${targetAgentName}*. Ele dará sequência ao seu atendimento em instantes! 💈`;

  // 3. Queue outbound WhatsApp message
  await outboundQueue.add('send-whatsapp-message', {
    establishmentId,
    phone: cleanPhone,
    text: transferNoticeText,
    isManual: false,
  });

  try {
    await redisConnection.publish('whatsapp-chat-updates', JSON.stringify({
      establishmentId,
      phone: cleanPhone,
      action: 'transfer',
      assignedAgentId: targetAgentId,
      assignedAgentName: targetAgentName,
      text: transferNoticeText,
      timestamp: new Date().toISOString()
    }));
  } catch (e) {}
}

export async function getActiveChats(establishmentId: string) {
  const isAll = establishmentId === 'all';
  const queryText = isAll
    ? `SELECT w.establishment_id, w.phone, w.push_name, w.bot_state as state, w.assigned_agent_id, w.assigned_agent_name, w.last_message_time, c.name as client_name,
              COALESCE(w.profile_picture_url, c.profile_picture_url) as profile_picture_url,
              e.name as establishment_name
       FROM whatsapp_chats w
       LEFT JOIN clients c ON w.phone = c.phone AND w.establishment_id = c.establishment_id
       LEFT JOIN establishments e ON w.establishment_id = e.id
       ORDER BY w.last_message_time DESC`
    : `SELECT w.establishment_id, w.phone, w.push_name, w.bot_state as state, w.assigned_agent_id, w.assigned_agent_name, w.last_message_time, c.name as client_name,
              COALESCE(w.profile_picture_url, c.profile_picture_url) as profile_picture_url,
              e.name as establishment_name
       FROM whatsapp_chats w
       LEFT JOIN clients c ON w.phone = c.phone AND w.establishment_id = c.establishment_id
       LEFT JOIN establishments e ON w.establishment_id = e.id
       WHERE w.establishment_id = $1
       ORDER BY w.last_message_time DESC`;

  const chatsRes = await pool.query(queryText, isAll ? [] : [establishmentId]);

  if (chatsRes.rows.length === 0) return [];

  const chatKeys = chatsRes.rows.map((r) => `${r.establishment_id}|${r.phone}`);

  const messagesRes = await pool.query(
    `SELECT establishment_id, phone, message_text AS text, from_me AS "fromMe", created_at, is_archived
     FROM (
       SELECT m.*,
              ROW_NUMBER() OVER (PARTITION BY m.establishment_id, m.phone ORDER BY m.id DESC) AS rn
       FROM whatsapp_messages m
       JOIN whatsapp_chats w ON m.establishment_id = w.establishment_id AND m.phone = w.phone
       WHERE (m.establishment_id::text || '|' || m.phone) = ANY($1)
         AND (
           (w.bot_state = 'IDLE' AND m.is_archived = true) OR
           (w.bot_state != 'IDLE' AND m.is_archived = false)
         )
     ) ranked
     WHERE rn <= 50
     ORDER BY establishment_id, phone, created_at ASC, id ASC`,
    [chatKeys]
  );

  const messagesByChat = new Map<string, { text: string; fromMe: boolean; time: string }[]>();
  for (const m of messagesRes.rows) {
    const key = `${m.establishment_id}|${m.phone}`;
    if (!messagesByChat.has(key)) messagesByChat.set(key, []);
    messagesByChat.get(key)!.push({
      text: m.text,
      fromMe: m.fromMe,
      time: new Date(m.created_at).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }),
    });
  }

  const chats: any[] = [];
  for (const row of chatsRes.rows) {
    const messages = messagesByChat.get(`${row.establishment_id}|${row.phone}`) || [];
    const displayName = row.client_name || row.push_name || 'Cliente';

    chats.push({
      establishmentId: row.establishment_id,
      establishmentName: row.establishment_name || (row.establishment_id === '00000000-0000-0000-0000-000000000000' ? 'Sistema Central (553498032768)' : 'Barbearia'),
      phone: row.phone,
      name: displayName,
      clientPushName: displayName,
      state: row.state,
      assignedAgentId: row.assigned_agent_id,
      assignedAgentName: row.assigned_agent_name,
      profilePictureUrl: row.profile_picture_url,
      messages
    });
  }

  return chats;
}

export async function getActiveSessionsList() {
  try {
    const res = await pool.query(
      "SELECT establishment_id, status, phone FROM whatsapp_sessions"
    );
    return res.rows.map(row => ({
      establishmentId: row.establishment_id,
      status: row.status === 'connected' ? 'CONNECTED' : 'DISCONNECTED',
      phone: row.phone
    }));
  } catch (e) {
    return [];
  }
}

export async function resolveLidRetroactively(lidJid: string, realPhone: string) {
  const cleanLid = lidJid.split('@')[0];
  const cleanPhone = realPhone.split('@')[0];

  if (cleanLid === cleanPhone) return;
  console.log(`[LidResolver] Discovered LID mapping: ${cleanLid} -> ${cleanPhone}. Updating databases...`);

  try {
    await pool.query(
      `INSERT INTO lid_mappings (lid, phone, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW()`,
      [cleanLid, cleanPhone]
    );
    // A tabela `appointments` não tem coluna `client_phone` (o telefone vive em
    // `clients`); o UPDATE que existia aqui falhava sempre com erro de SQL e
    // abortava o resto do remapeamento antes de corrigir os chats e mensagens.
    await pool.query("UPDATE clients SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
    await pool.query("UPDATE whatsapp_chats SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
    await pool.query("UPDATE whatsapp_messages SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
  } catch (err) {
    console.error('[LidResolver] Retroactive database updates failed:', err);
  }
}
