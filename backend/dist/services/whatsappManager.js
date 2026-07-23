"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWhatsAppSession = startWhatsAppSession;
exports.disconnectWhatsAppSession = disconnectWhatsAppSession;
exports.initializeAllWhatsAppSessions = initializeAllWhatsAppSessions;
exports.sendOrchestratedMessage = sendOrchestratedMessage;
exports.sendManualMessage = sendManualMessage;
exports.pauseChatBot = pauseChatBot;
exports.resumeChatBot = resumeChatBot;
exports.terminateChatSession = terminateChatSession;
exports.getActiveChats = getActiveChats;
exports.getActiveSessionsList = getActiveSessionsList;
exports.resolveLidRetroactively = resolveLidRetroactively;
const db_1 = __importDefault(require("../config/db"));
const redis_1 = require("../config/redis");
// -------------------------------------------------------------
// WhatsApp Session Orchestration (Redis Pub/Sub Driven)
// -------------------------------------------------------------
async function startWhatsAppSession(establishmentId) {
    console.log(`[SessionOrchestrator] Requesting start for WhatsApp session: ${establishmentId}...`);
    try {
        // Update DB status to connecting
        await db_1.default.query(`INSERT INTO whatsapp_sessions (establishment_id, status, updated_at)
       VALUES ($1, 'connecting', NOW())
       ON CONFLICT (establishment_id) DO UPDATE SET status = 'connecting', updated_at = NOW()`, [establishmentId]);
        // Publish event via Redis so WhatsApp Gateway instance connects this session
        await redis_1.redisConnection.publish('session:command', JSON.stringify({ action: 'start', establishmentId }));
    }
    catch (err) {
        console.error(`[SessionOrchestrator] Failed to start session for ${establishmentId}:`, err.message);
    }
}
async function disconnectWhatsAppSession(establishmentId) {
    console.log(`[SessionOrchestrator] Requesting disconnect for WhatsApp session: ${establishmentId}...`);
    try {
        // Publish event via Redis so WhatsApp Gateway closes session and cleans keys
        await redis_1.redisConnection.publish('session:command', JSON.stringify({ action: 'disconnect', establishmentId }));
        // Clean credentials and session status in DB
        await db_1.default.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
        await db_1.default.query(`INSERT INTO whatsapp_sessions (establishment_id, status, qr_code, phone, updated_at)
       VALUES ($1, 'disconnected', null, null, NOW())
       ON CONFLICT (establishment_id) 
       DO UPDATE SET status = 'disconnected', qr_code = null, phone = null, updated_at = NOW()`, [establishmentId]);
    }
    catch (err) {
        console.error(`[SessionOrchestrator] Failed to disconnect session for ${establishmentId}:`, err.message);
    }
}
async function initializeAllWhatsAppSessions() {
    console.log('[SessionOrchestrator] Signal sent to boot active WhatsApp sessions...');
    try {
        const res = await db_1.default.query("SELECT establishment_id FROM whatsapp_sessions WHERE status != 'disconnected'");
        for (const row of res.rows) {
            await startWhatsAppSession(row.establishment_id);
        }
    }
    catch (err) {
        console.error('[SessionOrchestrator] Session boot initialization failed:', err.message);
    }
}
// -------------------------------------------------------------
// Message Outbound Queue Operations (BullMQ Push)
// -------------------------------------------------------------
async function sendOrchestratedMessage(establishmentId, phone, text) {
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
            const ddd = parseInt(cleanPhone.substring(2, 4), 10);
            if (ddd > 28) {
                cleanPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
            }
        }
        await redis_1.outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone: cleanPhone,
            text,
        });
        return true;
    }
    catch (err) {
        console.error('[QueueOperations] Failed to push outbound orchestrated message to BullMQ:', err);
        return false;
    }
}
async function sendManualMessage(establishmentId, phone, text) {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
        const ddd = parseInt(cleanPhone.substring(2, 4), 10);
        if (ddd > 28) {
            cleanPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
        }
    }
    const formattedJid = `${cleanPhone}@s.whatsapp.net`;
    // 1. Queue outbound message in BullMQ
    await redis_1.outboundQueue.add('send-whatsapp-message', {
        establishmentId,
        phone: cleanPhone,
        text,
    });
    // 2. Automatically pause bot session to prevent chatbot auto-replies
    await db_1.default.query(`INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, last_message_time)
     VALUES ($1, $2, 'PAUSED', NOW())
     ON CONFLICT (establishment_id, phone) DO UPDATE SET bot_state = 'PAUSED', last_message_time = NOW()`, [establishmentId, cleanPhone]);
    return formattedJid;
}
// -------------------------------------------------------------
// Chat Control Panel Operations
// -------------------------------------------------------------
async function pauseChatBot(establishmentId, phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    await db_1.default.query(`UPDATE whatsapp_chats SET bot_state = 'PAUSED' WHERE establishment_id = $1 AND phone = $2`, [establishmentId, cleanPhone]);
}
async function resumeChatBot(establishmentId, phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    await db_1.default.query(`UPDATE whatsapp_chats SET bot_state = 'ACTIVE', current_node_id = 'welcome', waiting_for_input = false WHERE establishment_id = $1 AND phone = $2`, [establishmentId, cleanPhone]);
}
async function terminateChatSession(establishmentId, phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    await db_1.default.query(`UPDATE whatsapp_chats SET bot_state = 'IDLE', current_node_id = '', waiting_for_input = false WHERE establishment_id = $1 AND phone = $2`, [establishmentId, cleanPhone]);
}
async function getActiveChats(establishmentId) {
    const chatsRes = await db_1.default.query(`SELECT w.phone, w.push_name, w.bot_state as state, w.last_message_time, c.name as client_name,
            COALESCE(w.profile_picture_url, c.profile_picture_url) as profile_picture_url
     FROM whatsapp_chats w
     LEFT JOIN clients c ON w.phone = c.phone AND w.establishment_id = c.establishment_id
     WHERE w.establishment_id = $1
     ORDER BY w.last_message_time DESC`, [establishmentId]);
    const chats = [];
    for (const row of chatsRes.rows) {
        const msgsRes = await db_1.default.query(`SELECT message_text as text, from_me as "fromMe", created_at
       FROM whatsapp_messages
       WHERE establishment_id = $1 AND phone = $2
       ORDER BY id ASC LIMIT 50`, [establishmentId, row.phone]);
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
async function getActiveSessionsList() {
    try {
        const res = await db_1.default.query("SELECT establishment_id, status, phone FROM whatsapp_sessions");
        return res.rows.map(row => ({
            establishmentId: row.establishment_id,
            status: row.status === 'connected' ? 'CONNECTED' : 'DISCONNECTED',
            phone: row.phone
        }));
    }
    catch (e) {
        return [];
    }
}
async function resolveLidRetroactively(lidJid, realPhone) {
    const cleanLid = lidJid.split('@')[0];
    const cleanPhone = realPhone.split('@')[0];
    if (cleanLid === cleanPhone)
        return;
    console.log(`[LidResolver] Discovered LID mapping: ${cleanLid} -> ${cleanPhone}. Updating databases...`);
    try {
        await db_1.default.query(`INSERT INTO lid_mappings (lid, phone, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW()`, [cleanLid, cleanPhone]);
        await db_1.default.query("UPDATE appointments SET client_phone = $1 WHERE client_phone = $2", [cleanPhone, cleanLid]);
        await db_1.default.query("UPDATE clients SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
        await db_1.default.query("UPDATE whatsapp_chats SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
        await db_1.default.query("UPDATE whatsapp_messages SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
    }
    catch (err) {
        console.error('[LidResolver] Retroactive database updates failed:', err);
    }
}
