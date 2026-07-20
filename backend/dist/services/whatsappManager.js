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
exports.getActiveEstablishmentSockets = getActiveEstablishmentSockets;
exports.getActiveSessionsList = getActiveSessionsList;
exports.resolveLidRetroactively = resolveLidRetroactively;
const http_1 = __importDefault(require("http"));
const db_1 = __importDefault(require("../config/db"));
const BOT_SIGNATURE = '🤖 *Atendimento Automático*';
// -------------------------------------------------------------
// Docker API UNIX Socket Client
// -------------------------------------------------------------
function callDockerAPI(options, body) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            socketPath: '/var/run/docker.sock',
            ...options
        };
        const req = http_1.default.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(data ? JSON.parse(data) : {});
                }
                catch (e) {
                    resolve(data);
                }
            });
        });
        req.on('error', (err) => {
            console.error('[DockerAPI] Request error:', err.message);
            reject(err);
        });
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}
// Helper to check if a container exists and is running
async function getContainerState(containerName) {
    try {
        const data = await callDockerAPI({
            path: `/containers/${containerName}/json`,
            method: 'GET'
        });
        if (data && data.State) {
            return { exists: true, running: data.State.Running };
        }
        return { exists: false, running: false };
    }
    catch (err) {
        // 404 means container does not exist
        return { exists: false, running: false };
    }
}
// -------------------------------------------------------------
// WhatsApp Session Container Orchestration Daemon
// -------------------------------------------------------------
async function startWhatsAppSession(establishmentId) {
    const containerName = `barberhub-whatsapp-${establishmentId}`;
    console.log(`[DockerOrchestrator] Starting session check for establishment ${establishmentId}...`);
    try {
        const state = await getContainerState(containerName);
        if (!state.exists) {
            console.log(`[DockerOrchestrator] Creating new WhatsApp container for ${establishmentId}...`);
            await callDockerAPI({
                path: `/containers/create?name=${containerName}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, {
                Image: 'barberhub-whatsapp-bot:latest',
                Env: [
                    `ESTABLISHMENT_ID=${establishmentId}`,
                    `DB_USER=${process.env.DB_USER || 'postgres'}`,
                    `DB_HOST=127.0.0.1`,
                    `DB_DATABASE=${process.env.DB_DATABASE || 'bot_whatsapp'}`,
                    `DB_PASSWORD=${process.env.DB_PASSWORD || 'postgres'}`,
                    `DB_PORT=${process.env.DB_PORT || '5432'}`,
                    `TZ=America/Sao_Paulo`
                ],
                HostConfig: {
                    NetworkMode: 'host',
                    RestartPolicy: { Name: 'always' }
                }
            });
        }
        const updatedState = await getContainerState(containerName);
        if (!updatedState.running) {
            console.log(`[DockerOrchestrator] Starting container ${containerName}...`);
            await callDockerAPI({
                path: `/containers/${containerName}/start`,
                method: 'POST'
            });
        }
        else {
            console.log(`[DockerOrchestrator] Container ${containerName} is already running.`);
        }
        // Mark status in db as connecting if currently disconnected
        const sessionRes = await db_1.default.query('SELECT status FROM whatsapp_sessions WHERE establishment_id = $1', [establishmentId]);
        if (sessionRes.rows.length === 0 || sessionRes.rows[0].status === 'disconnected') {
            await db_1.default.query(`INSERT INTO whatsapp_sessions (establishment_id, status, updated_at)
         VALUES ($1, 'connecting', NOW())
         ON CONFLICT (establishment_id) DO UPDATE SET status = 'connecting', updated_at = NOW()`, [establishmentId]);
        }
    }
    catch (err) {
        console.error(`[DockerOrchestrator] Failed to orchestrate session for ${establishmentId}:`, err.message);
    }
}
async function disconnectWhatsAppSession(establishmentId) {
    const containerName = `barberhub-whatsapp-${establishmentId}`;
    console.log(`[DockerOrchestrator] Disconnecting WhatsApp session for ${establishmentId}...`);
    try {
        const state = await getContainerState(containerName);
        if (state.exists) {
            console.log(`[DockerOrchestrator] Stopping container ${containerName}...`);
            try {
                await callDockerAPI({
                    path: `/containers/${containerName}/stop`,
                    method: 'POST'
                });
            }
            catch (e) { }
            console.log(`[DockerOrchestrator] Removing container ${containerName}...`);
            try {
                await callDockerAPI({
                    path: `/containers/${containerName}?v=true&force=true`,
                    method: 'DELETE'
                });
            }
            catch (e) { }
        }
        // Clean credentials and session status in DB
        await db_1.default.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
        await db_1.default.query(`INSERT INTO whatsapp_sessions (establishment_id, status, qr_code, phone, updated_at)
       VALUES ($1, 'disconnected', null, null, NOW())
       ON CONFLICT (establishment_id) 
       DO UPDATE SET status = 'disconnected', qr_code = null, phone = null, updated_at = NOW()`, [establishmentId]);
    }
    catch (err) {
        console.error(`[DockerOrchestrator] Failed to disconnect session for ${establishmentId}:`, err.message);
    }
}
async function initializeAllWhatsAppSessions() {
    console.log('[DockerOrchestrator] Booting WhatsApp session orchestrator daemon...');
    try {
        const res = await db_1.default.query("SELECT establishment_id, status FROM whatsapp_sessions WHERE status != 'disconnected'");
        console.log(`[DockerOrchestrator] Found ${res.rows.length} sessions to initialize.`);
        for (const row of res.rows) {
            await startWhatsAppSession(row.establishment_id);
        }
    }
    catch (err) {
        console.error('[DockerOrchestrator] Session boot initialization failed:', err.message);
    }
}
// -------------------------------------------------------------
// Message Outbound Queue Operations
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
        const formattedJid = `${cleanPhone}@s.whatsapp.net`;
        await db_1.default.query(`INSERT INTO whatsapp_queue (establishment_id, phone, message, status)
       VALUES ($1, $2, $3, 'pending')`, [establishmentId, formattedJid, text]);
        return true;
    }
    catch (err) {
        console.error('[QueueOperations] Failed to queue outbound orchestrated message:', err);
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
    // 1. Queue outbound human message
    await db_1.default.query(`INSERT INTO whatsapp_queue (establishment_id, phone, message, status)
     VALUES ($1, $2, $3, 'pending')`, [establishmentId, formattedJid, text]);
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
        // Fetch last 50 messages from whatsapp_messages table
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
function getActiveEstablishmentSockets() {
    // Legacy stub helper for reminder service to scan active sessions status.
    // Since we now check status in DB, we can return the active connected database sessions.
    return [];
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
    console.log(`[DockerOrchestrator] Discovered LID mapping: ${cleanLid} -> ${cleanPhone}. Updating databases...`);
    try {
        // 0. Save the mapping to lid_mappings table
        await db_1.default.query(`INSERT INTO lid_mappings (lid, phone, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW()`, [cleanLid, cleanPhone]);
        // 1. Update appointments
        await db_1.default.query("UPDATE appointments SET client_phone = $1 WHERE client_phone = $2", [cleanPhone, cleanLid]);
        // 2. Update clients
        await db_1.default.query("UPDATE clients SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
        // 3. Update active chats
        await db_1.default.query("UPDATE whatsapp_chats SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
        await db_1.default.query("UPDATE whatsapp_messages SET phone = $1 WHERE phone = $2", [cleanPhone, cleanLid]);
    }
    catch (err) {
        console.error('[LidResolver] Retroactive database updates failed:', err);
    }
}
