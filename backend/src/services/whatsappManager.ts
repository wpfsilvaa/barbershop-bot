import pool from '../config/db';
import { outboundQueue, redisConnection } from '../config/redis';

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
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
      const ddd = parseInt(cleanPhone.substring(2, 4), 10);
      if (ddd > 28) {
        cleanPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
      }
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

export async function sendManualMessage(establishmentId: string, phone: string, text: string): Promise<string> {
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
    const ddd = parseInt(cleanPhone.substring(2, 4), 10);
    if (ddd > 28) {
      cleanPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
    }
  }
  const formattedJid = `${cleanPhone}@s.whatsapp.net`;

  // 1. Queue outbound message in BullMQ
  await outboundQueue.add('send-whatsapp-message', {
    establishmentId,
    phone: cleanPhone,
    text,
  });

  // 2. Insert into whatsapp_messages for chat history
  await pool.query(
    `INSERT INTO whatsapp_messages (establishment_id, phone, message_text, from_me, created_at)
     VALUES ($1, $2, $3, true, NOW())`,
    [establishmentId, cleanPhone, text]
  );

  // 3. Automatically pause bot session to prevent chatbot auto-replies
  await pool.query(
    `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, last_message_time)
     VALUES ($1, $2, 'PAUSED', NOW())
     ON CONFLICT (establishment_id, phone) DO UPDATE SET bot_state = 'PAUSED', last_message_time = NOW()`,
    [establishmentId, cleanPhone]
  );

  // 4. Publish SSE event via Redis Pub/Sub
  try {
    await redisConnection.publish('whatsapp-chat-updates', JSON.stringify({
      establishmentId,
      phone: cleanPhone,
      text,
      fromMe: true,
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    console.error('[Backend] Error publishing SSE chat update:', err);
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
    `UPDATE whatsapp_chats SET bot_state = 'ACTIVE', current_node_id = 'welcome', waiting_for_input = false WHERE establishment_id = $1 AND phone = $2`,
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
    `UPDATE whatsapp_chats SET bot_state = 'IDLE', current_node_id = '', waiting_for_input = false WHERE establishment_id = $1 AND phone = $2`,
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

export async function getActiveChats(establishmentId: string) {
  const isAll = establishmentId === 'all';
  const queryText = isAll
    ? `SELECT w.establishment_id, w.phone, w.push_name, w.bot_state as state, w.last_message_time, c.name as client_name,
              COALESCE(w.profile_picture_url, c.profile_picture_url) as profile_picture_url,
              e.name as establishment_name
       FROM whatsapp_chats w
       LEFT JOIN clients c ON w.phone = c.phone AND w.establishment_id = c.establishment_id
       LEFT JOIN establishments e ON w.establishment_id = e.id
       ORDER BY w.last_message_time DESC`
    : `SELECT w.establishment_id, w.phone, w.push_name, w.bot_state as state, w.last_message_time, c.name as client_name,
              COALESCE(w.profile_picture_url, c.profile_picture_url) as profile_picture_url,
              e.name as establishment_name
       FROM whatsapp_chats w
       LEFT JOIN clients c ON w.phone = c.phone AND w.establishment_id = c.establishment_id
       LEFT JOIN establishments e ON w.establishment_id = e.id
       WHERE w.establishment_id = $1
       ORDER BY w.last_message_time DESC`;

  const chatsRes = await pool.query(queryText, isAll ? [] : [establishmentId]);

  const chats: any[] = [];
  for (const row of chatsRes.rows) {
    const msgsRes = await pool.query(
      `SELECT message_text as text, from_me as "fromMe", created_at
       FROM whatsapp_messages
       WHERE establishment_id = $1 AND phone = $2
       ORDER BY id ASC LIMIT 50`,
      [row.establishment_id, row.phone]
    );

    const messages = msgsRes.rows.map(m => {
      const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      return {
        text: m.text,
        fromMe: m.fromMe,
        time
      };
    });

    const displayName = row.client_name || row.push_name || 'Cliente';

    chats.push({
      establishmentId: row.establishment_id,
      establishmentName: row.establishment_name || (row.establishment_id === '00000000-0000-0000-0000-000000000000' ? 'Sistema Central (553498032768)' : 'Barbearia'),
      phone: row.phone,
      name: displayName,
      clientPushName: displayName,
      state: row.state,
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
    await pool.query("UPDATE appointments SET client_phone = $1 WHERE client_phone = $2", [cleanPhone, cleanLid]);
    await pool.query("UPDATE clients SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
    await pool.query("UPDATE whatsapp_chats SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
    await pool.query("UPDATE whatsapp_messages SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
  } catch (err) {
    console.error('[LidResolver] Retroactive database updates failed:', err);
  }
}
