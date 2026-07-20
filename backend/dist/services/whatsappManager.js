"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAllWhatsAppSessions = initializeAllWhatsAppSessions;
exports.startWhatsAppSession = startWhatsAppSession;
exports.disconnectWhatsAppSession = disconnectWhatsAppSession;
exports.sendOrchestratedMessage = sendOrchestratedMessage;
exports.getActiveEstablishmentSockets = getActiveEstablishmentSockets;
exports.getActiveChats = getActiveChats;
exports.pauseChatBot = pauseChatBot;
exports.resumeChatBot = resumeChatBot;
exports.terminateChatSession = terminateChatSession;
exports.sendManualMessage = sendManualMessage;
exports.getActiveSessionsList = getActiveSessionsList;
exports.resolveLidRetroactively = resolveLidRetroactively;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const crypto_1 = __importDefault(require("crypto"));
const pino_1 = __importDefault(require("pino"));
const db_1 = __importDefault(require("../config/db"));
const dbAuthStore_1 = require("./dbAuthStore");
const planController_1 = require("../controllers/planController");
const logger = (0, pino_1.default)({ level: 'silent' });
// Keep map of active sockets in memory: establishment_id -> WASocket
const activeSockets = new Map();
const botSessions = new Map();
function addSessionMessage(session, text, fromMe, isPoll = false, pollOptions) {
    if (!session.messages) {
        session.messages = [];
    }
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    session.messages.push({ text, fromMe, time, isPoll, pollOptions });
    if (session.messages.length > 50) {
        session.messages.shift();
    }
}
// Mapeamento global de LID -> Phone (para resolver JID do WhatsApp)
const lidToPhoneMap = new Map();
// Cache of sent messages (for decrypting poll updates): message_id -> proto.IMessage
const messageStore = new Map();
const BOT_SIGNATURE = '🤖 *Atendimento Automático*';
const processedMessages = new Set();
const sessionLocks = new Map();
function sanitizeMessageText(text) {
    if (!text)
        return '';
    return text.replace(/\\n/g, '\n');
}
async function sendTextMessage(sock, phone, text) {
    const sanitized = sanitizeMessageText(text);
    const textWithSignature = `${sanitized}\n\n${BOT_SIGNATURE}`;
    const sentMsg = await sock.sendMessage(phone, { text: textWithSignature });
    if (sentMsg?.key?.id && sentMsg?.message) {
        messageStore.set(sentMsg.key.id, sentMsg.message);
    }
    let estId;
    for (const [key, value] of activeSockets.entries()) {
        if (value === sock) {
            estId = key;
            break;
        }
    }
    if (estId) {
        const cleanPhone = phone.split('@')[0];
        const session = getBotSession(cleanPhone, estId);
        addSessionMessage(session, text, true);
    }
    return sentMsg;
}
async function getPollSelectedOption(sock, msg) {
    const pollUpdate = msg.message?.pollUpdateMessage;
    if (!pollUpdate || !pollUpdate.vote)
        return null;
    const pollCreationKey = pollUpdate.pollCreationMessageKey;
    if (!pollCreationKey || !pollCreationKey.id)
        return null;
    const pollMsg = messageStore.get(pollCreationKey.id);
    if (!pollMsg) {
        console.warn(`[PollDecrypt] Original poll message not found for key: ${pollCreationKey.id}`);
        return null;
    }
    try {
        const pollCreatorJid = (0, baileys_1.jidNormalizedUser)(pollCreationKey.fromMe
            ? (sock.user?.id ? sock.user.id : pollCreationKey.remoteJid)
            : pollCreationKey.remoteJid);
        const voterJid = (0, baileys_1.jidNormalizedUser)(msg.key?.participant || msg.key?.remoteJid);
        const pollEncKey = pollMsg.messageContextInfo?.messageSecret;
        if (!pollEncKey) {
            console.warn(`[PollDecrypt] Message secret not found in original poll message: ${pollCreationKey.id}`);
            return null;
        }
        const decryptedVote = (0, baileys_1.decryptPollVote)(pollUpdate.vote, {
            pollCreatorJid: pollCreatorJid,
            pollMsgId: pollCreationKey.id,
            pollEncKey: pollEncKey,
            voterJid: voterJid
        });
        if (!decryptedVote.selectedOptions || decryptedVote.selectedOptions.length === 0) {
            return null;
        }
        const selectedHash = Buffer.from(decryptedVote.selectedOptions[0]).toString('hex').toUpperCase();
        const pollCreationMsg = pollMsg.pollCreationMessage || pollMsg.pollCreationMessageV2 || pollMsg.pollCreationMessageV3;
        if (!pollCreationMsg || !pollCreationMsg.options) {
            return null;
        }
        for (const option of pollCreationMsg.options) {
            const optionName = option.optionName || '';
            const optionHash = crypto_1.default.createHash('sha256').update(optionName).digest('hex').toUpperCase();
            if (optionHash === selectedHash) {
                return optionName;
            }
        }
    }
    catch (err) {
        console.error('[PollDecrypt] Failed to decrypt poll vote:', err);
    }
    return null;
}
function formatPhoneForWhatsapp(phone) {
    let clean = phone.replace(/\D/g, '').trim();
    if (clean.startsWith('55')) {
        clean = clean.substring(2);
    }
    if (clean.length === 11 && clean[2] === '9') {
        clean = clean.substring(0, 2) + clean.substring(3);
    }
    return '55' + clean;
}
function normalizeJid(phone) {
    if (!phone)
        return phone;
    let clean = phone.trim();
    if (clean.endsWith('@lid')) {
        return clean;
    }
    let part = clean.split('@')[0];
    if (part.startsWith('55') || (part.length >= 10 && !clean.includes('@'))) {
        part = formatPhoneForWhatsapp(part);
    }
    return `${part}@s.whatsapp.net`;
}
const getBotSession = (phone, establishmentId) => {
    const normalized = normalizeJid(phone);
    const key = `${normalized}_${establishmentId}`;
    if (!botSessions.has(key)) {
        botSessions.set(key, {
            state: 'IDLE',
            currentNodeId: 'welcome',
            waitingForInput: false
        });
    }
    return botSessions.get(key);
};
// Next 5 working days generator helper
const getNextWorkingDays = (count = 5) => {
    const days = [];
    const now = new Date();
    const weekdayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    for (let i = 0; i < count; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() + i);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const dateStr = d.toISOString().split('T')[0];
        let label = '';
        if (i === 0)
            label = `Hoje (${day}/${month})`;
        else if (i === 1)
            label = `Amanhã (${day}/${month})`;
        else
            label = `${weekdayNames[d.getDay()]} (${day}/${month})`;
        days.push({ dateStr, label });
    }
    return days;
};
const formatTime = (isoString) => {
    const date = new Date(isoString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};
const replacePlaceholders = (template, data) => {
    let text = template;
    if (data.cliente)
        text = text.replace(/{cliente}/g, data.cliente);
    if (data.estabelecimento)
        text = text.replace(/{estabelecimento}/g, data.estabelecimento);
    if (data.abertura)
        text = text.replace(/{abertura}/g, data.abertura);
    if (data.fechamento)
        text = text.replace(/{fechamento}/g, data.fechamento);
    if (data.barbeiros)
        text = text.replace(/{barbeiros}/g, data.barbeiros);
    if (data.datas)
        text = text.replace(/{datas}/g, data.datas);
    if (data.horarios)
        text = text.replace(/{horarios}/g, data.horarios);
    if (data.barbeiro)
        text = text.replace(/{barbeiro}/g, data.barbeiro);
    if (data.horario)
        text = text.replace(/{horario}/g, data.horario);
    if (data.data)
        text = text.replace(/{data}/g, data.data);
    return text;
};
// Database session logger helper
async function updateSessionStatus(establishmentId, status, qrCode = null, phone = null) {
    try {
        await db_1.default.query(`INSERT INTO whatsapp_sessions (establishment_id, phone, status, qr_code, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (establishment_id) 
       DO UPDATE SET phone = COALESCE(EXCLUDED.phone, whatsapp_sessions.phone),
                     status = EXCLUDED.status,
                     qr_code = EXCLUDED.qr_code,
                     updated_at = CURRENT_TIMESTAMP`, [establishmentId, phone, status, qrCode]);
    }
    catch (err) {
        console.error(`Failed to update DB whatsapp session status for ${establishmentId}:`, err);
    }
}
// -------------------------------------------------------------
// Orchestrator Actions
// -------------------------------------------------------------
async function initializeAllWhatsAppSessions() {
    console.log('Orchestrator: Initializing WhatsApp sessions for all establishments...');
    try {
        const result = await db_1.default.query('SELECT id, name FROM establishments');
        console.log(`Orchestrator: Found ${result.rows.length} establishments to boot.`);
        for (const row of result.rows) {
            startWhatsAppSession(row.id).catch((err) => {
                console.error(`Orchestrator: Failed to start session for ${row.name} (${row.id}):`, err);
            });
        }
    }
    catch (err) {
        console.error('Orchestrator initialization error:', err);
    }
}
async function startWhatsAppSession(establishmentId) {
    if (activeSockets.has(establishmentId)) {
        const existingSock = activeSockets.get(establishmentId);
        return existingSock;
    }
    console.log(`[SessionManager] Starting WhatsApp connection for establishment ${establishmentId}...`);
    await updateSessionStatus(establishmentId, 'connecting');
    try {
        const { state: authState, saveCreds } = await (0, dbAuthStore_1.usePostgresAuthState)(establishmentId);
        const sock = (0, baileys_1.default)({
            auth: authState,
            printQRInTerminal: false,
            logger,
            getMessage: async (key) => {
                return key.id ? messageStore.get(key.id) : undefined;
            }
        });
        activeSockets.set(establishmentId, sock);
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                await updateSessionStatus(establishmentId, 'qr_ready', qr);
                console.log(`[SessionManager] Establishment ${establishmentId}: QR Code received.`);
            }
            if (connection === 'close') {
                const error = lastDisconnect?.error;
                const statusCode = error?.output?.statusCode;
                const shouldReconnect = statusCode !== baileys_1.DisconnectReason.loggedOut;
                console.log(`[SessionManager] Establishment ${establishmentId}: connection closed (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
                activeSockets.delete(establishmentId);
                if (statusCode === baileys_1.DisconnectReason.loggedOut) {
                    await db_1.default.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
                    await updateSessionStatus(establishmentId, 'disconnected', null, null);
                }
                else {
                    await updateSessionStatus(establishmentId, 'disconnected', null);
                }
                if (shouldReconnect) {
                    setTimeout(() => {
                        startWhatsAppSession(establishmentId).catch((err) => console.error(err));
                    }, 5000);
                }
            }
            else if (connection === 'open') {
                const phoneJid = sock.user?.id;
                const cleanPhone = phoneJid ? phoneJid.split(':')[0].split('@')[0] : null;
                console.log(`[SessionManager] Establishment ${establishmentId}: Connection established successfully on number ${cleanPhone}!`);
                await updateSessionStatus(establishmentId, 'connected', null, cleanPhone);
            }
        });
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify')
                return;
            // Check if establishment is active (master system session is always active)
            if (establishmentId !== '00000000-0000-0000-0000-000000000000') {
                try {
                    const estCheck = await db_1.default.query('SELECT is_active FROM establishments WHERE id = $1', [establishmentId]);
                    if (estCheck.rows.length > 0 && !estCheck.rows[0].is_active) {
                        console.log(`[SessionManager] Establishment ${establishmentId} is INACTIVE/SUSPENDED. Ignoring incoming messages.`);
                        return;
                    }
                }
                catch (err) {
                    console.error('[SessionManager] Error checking active status:', err);
                }
            }
            for (const msg of m.messages) {
                if (!msg.key.fromMe && msg.message) {
                    await handleTenantBotFlow(establishmentId, sock, msg);
                }
            }
        });
        sock.ev.on('messages.update', (updates) => {
            for (const update of updates) {
                if (update.key.id && update.update.message) {
                    const existing = messageStore.get(update.key.id);
                    if (existing) {
                        messageStore.set(update.key.id, {
                            ...existing,
                            ...update.update.message
                        });
                    }
                    else {
                        messageStore.set(update.key.id, update.update.message);
                    }
                }
            }
        });
        sock.ev.on('contacts.upsert', (contacts) => {
            for (const contact of contacts) {
                // Case 1: contact.lid is defined, mapping contact.lid -> contact.id
                if (contact.lid && contact.id) {
                    const cleanPhone = contact.id.split('@')[0].replace(/\D/g, '');
                    if (cleanPhone) {
                        resolveLidRetroactively(contact.lid, cleanPhone).catch((err) => {
                            console.error('[LidResolverUpsert] Error resolving LID retroactively:', err);
                        });
                    }
                }
                // Case 2: contact.id ends with @lid, mapping contact.id -> contact.phone / contact.phoneNumber
                if (contact.id && contact.id.endsWith('@lid')) {
                    const phoneNum = contact.phoneNumber || contact.username || contact.phone;
                    if (phoneNum) {
                        const cleanPhone = phoneNum.replace(/\D/g, '');
                        resolveLidRetroactively(contact.id, cleanPhone).catch((err) => {
                            console.error('[LidResolverUpsert] Error resolving LID retroactively:', err);
                        });
                    }
                }
            }
        });
        sock.ev.on('contacts.update', (contacts) => {
            for (const contact of contacts) {
                // Case 1: contact.lid is defined, mapping contact.lid -> contact.id
                if (contact.lid && contact.id) {
                    const cleanPhone = contact.id.split('@')[0].replace(/\D/g, '');
                    if (cleanPhone) {
                        resolveLidRetroactively(contact.lid, cleanPhone).catch((err) => {
                            console.error('[LidResolverUpdate] Error resolving LID retroactively:', err);
                        });
                    }
                }
                // Case 2: contact.id ends with @lid, mapping contact.id -> contact.phone / contact.phoneNumber
                if (contact.id && contact.id.endsWith('@lid')) {
                    const phoneNum = contact.phoneNumber || contact.username || contact.phone;
                    if (phoneNum) {
                        const cleanPhone = phoneNum.replace(/\D/g, '');
                        resolveLidRetroactively(contact.id, cleanPhone).catch((err) => {
                            console.error('[LidResolverUpdate] Error resolving LID retroactively:', err);
                        });
                    }
                }
            }
        });
        return sock;
    }
    catch (err) {
        console.error(`[SessionManager] Setup crash for establishment ${establishmentId}:`, err);
        await updateSessionStatus(establishmentId, 'disconnected');
        setTimeout(() => {
            startWhatsAppSession(establishmentId).catch((e) => console.error(e));
        }, 5000);
        throw err;
    }
}
async function disconnectWhatsAppSession(establishmentId) {
    console.log(`[SessionManager] Logging out WhatsApp session for establishment ${establishmentId}...`);
    const sock = activeSockets.get(establishmentId);
    if (sock) {
        try {
            await sock.logout();
        }
        catch (err) {
            console.warn('Socket logout warning:', err);
        }
        activeSockets.delete(establishmentId);
    }
    await db_1.default.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1', [establishmentId]);
    await updateSessionStatus(establishmentId, 'disconnected', null, null);
}
async function sendOrchestratedMessage(establishmentId, phone, text) {
    const sock = activeSockets.get(establishmentId);
    if (!sock) {
        console.warn(`[SessionManager] No active WhatsApp session found for establishment ${establishmentId}. Message not sent.`);
        return false;
    }
    // Sanitize and format JID correctly, handling Brazilian 9th digit rules
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('55') && cleanPhone.length === 13) {
        const ddd = parseInt(cleanPhone.substring(2, 4), 10);
        if (ddd > 28) {
            // Remove the 9th digit (at index 4) for DDDs > 28
            cleanPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
        }
    }
    const formattedPhone = `${cleanPhone}@s.whatsapp.net`;
    try {
        const sanitized = sanitizeMessageText(text);
        const textWithSignature = `${sanitized}\n\n${BOT_SIGNATURE}`;
        const sentMsg = await sock.sendMessage(formattedPhone, { text: textWithSignature });
        if (sentMsg?.key?.id && sentMsg?.message) {
            messageStore.set(sentMsg.key.id, sentMsg.message);
        }
        return true;
    }
    catch (err) {
        console.error(`[SessionManager] Failed to send message for establishment ${establishmentId} to JID ${formattedPhone}:`, err);
        return false;
    }
}
function getActiveEstablishmentSockets() {
    return Array.from(activeSockets.entries());
}
// -------------------------------------------------------------
// Conversational Tenant Flow Graph Traversal Engine
// -------------------------------------------------------------
async function handleTenantBotFlow(establishmentId, sock, msg) {
    const msgId = msg.key?.id;
    if (msgId) {
        if (processedMessages.has(msgId)) {
            return;
        }
        processedMessages.add(msgId);
        if (processedMessages.size > 2000) {
            const first = processedMessages.values().next().value;
            if (first)
                processedMessages.delete(first);
        }
    }
    let rawPhone = msg.key?.remoteJid;
    if (!rawPhone)
        return;
    // 1. Try to resolve PN (Phone Number) JID directly from message metadata fields if remoteJid is LID
    if (rawPhone.endsWith('@lid')) {
        const remoteJidAlt = msg.key.remoteJidAlt;
        const senderPn = msg.senderPn;
        if (remoteJidAlt && remoteJidAlt.endsWith('@s.whatsapp.net')) {
            rawPhone = remoteJidAlt;
            console.log(`[LidResolverMsg] Resolved JID from msg.key.remoteJidAlt: ${rawPhone}`);
        }
        else if (senderPn && senderPn.endsWith('@s.whatsapp.net')) {
            rawPhone = senderPn;
            console.log(`[LidResolverMsg] Resolved JID from msg.senderPn: ${rawPhone}`);
        }
    }
    let phone = normalizeJid(rawPhone);
    if (phone.endsWith('@lid')) {
        let mappedPhone = lidToPhoneMap.get(phone);
        if (!mappedPhone) {
            try {
                const lidNumber = phone.split('@')[0];
                const dbMapping = await db_1.default.query("SELECT phone FROM lid_mappings WHERE lid = $1", [lidNumber]);
                if (dbMapping.rows.length > 0) {
                    mappedPhone = dbMapping.rows[0].phone;
                    lidToPhoneMap.set(phone, mappedPhone);
                    lidToPhoneMap.set(`${lidNumber}@lid`, mappedPhone);
                    console.log(`[LidResolverDb] Found persistent mapping for LID ${lidNumber}: ${mappedPhone}`);
                }
            }
            catch (err) {
                console.error('[LidResolverDb] Error querying lid_mappings:', err);
            }
        }
        if (mappedPhone) {
            phone = `${mappedPhone}@s.whatsapp.net`;
        }
    }
    // Save the mapping discovered from message metadata sync if applicable
    if (msg.key?.remoteJid && msg.key.remoteJid.endsWith('@lid') && phone.endsWith('@s.whatsapp.net')) {
        const cleanLid = msg.key.remoteJid.split('@')[0];
        const cleanPhone = phone.split('@')[0];
        if (cleanLid !== cleanPhone) {
            resolveLidRetroactively(msg.key.remoteJid, phone).catch((err) => {
                console.error('[LidResolverMsgSync] Failed to resolve LID retroactively:', err);
            });
        }
    }
    const lockKey = `${phone}_${establishmentId}`;
    const currentLock = sessionLocks.get(lockKey) || Promise.resolve();
    const nextLock = currentLock.then(async () => {
        try {
            await executeTenantBotFlowLogic(establishmentId, sock, msg, phone);
        }
        catch (err) {
            console.error('[BotFlowLock] Error executing bot flow logic:', err);
        }
    });
    sessionLocks.set(lockKey, nextLock);
    nextLock.finally(() => {
        if (sessionLocks.get(lockKey) === nextLock) {
            sessionLocks.delete(lockKey);
        }
    });
}
async function executeTenantBotFlowLogic(establishmentId, sock, msg, phone) {
    if (!msg.message)
        return;
    let text = (msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '').trim();
    // If poll update message, try to decrypt the selected option
    if (msg.message.pollUpdateMessage) {
        const selectedOption = await getPollSelectedOption(sock, msg);
        if (selectedOption) {
            text = selectedOption;
        }
        else {
            return;
        }
    }
    if (!text)
        return;
    // Ignore messages containing the bot's signature to prevent infinite bot-reply loops
    if (text.includes(BOT_SIGNATURE) || text.includes('Atendimento Automático')) {
        return;
    }
    const pushName = msg.pushName || 'Cliente';
    const session = getBotSession(phone, establishmentId);
    session.clientPushName = pushName;
    addSessionMessage(session, text, false);
    if (session.state === 'PAUSED') {
        return; // Ignore messages when bot is paused (human takeover)
    }
    try {
        const cleanPhone = phone.split('@')[0];
        // Verificar se o cliente já está cadastrado no estabelecimento
        const clientCheck = await db_1.default.query('SELECT id, name FROM clients WHERE phone = $1 AND establishment_id = $2', [cleanPhone, establishmentId]);
        // Fluxo de Cadastro de Primeiro Contato
        if (session.currentNodeId === 'register_client') {
            const clientName = text.trim();
            if (clientName.length < 3) {
                await sendTextMessage(sock, phone, '⚠️ O nome precisa ter pelo menos 3 caracteres. Por favor, digite seu nome completo:');
                return;
            }
            // Inserir ou atualizar na tabela de clientes
            await db_1.default.query(`INSERT INTO clients (establishment_id, name, phone)
         VALUES ($1, $2, $3)
         ON CONFLICT (establishment_id, phone) 
         DO UPDATE SET name = EXCLUDED.name`, [establishmentId, clientName, cleanPhone]);
            await sendTextMessage(sock, phone, `🎉 *Cadastro realizado com sucesso, ${clientName}!* Vamos prosseguir.`);
            // Prossegue para o menu inicial do bot
            session.state = 'ACTIVE';
            session.currentNodeId = 'welcome';
            session.waitingForInput = false;
            // Permite cair no fluxo padrão de renderização do grafo abaixo
        }
        else if (session.currentNodeId === 'ask_promotions') {
            let option = parseInt(text, 10);
            if (isNaN(option)) {
                if (text.toLowerCase().includes('sim') || text.toLowerCase().includes('aceito') || text.toLowerCase().includes('quero')) {
                    option = 1;
                }
                else if (text.toLowerCase().includes('não') || text.toLowerCase().includes('nao') || text.toLowerCase().includes('obrigado')) {
                    option = 2;
                }
            }
            if (option !== 1 && option !== 2) {
                await sendTextMessage(sock, phone, '⚠️ Opção inválida. Responda com *1* (Sim) ou *2* (Não):');
                return;
            }
            const acceptPromos = (option === 1);
            // Update clients table
            await db_1.default.query("UPDATE clients SET accept_promotions = $1 WHERE phone = $2 AND establishment_id = $3", [acceptPromos, cleanPhone, establishmentId]);
            if (acceptPromos) {
                await sendTextMessage(sock, phone, '🎉 *Que ótimo!* Você foi cadastrado na nossa lista de promoções e receberá nossas novidades em primeira mão! Obrigado! 👍');
            }
            else {
                await sendTextMessage(sock, phone, 'Certo! Você não receberá mensagens de promoção. Se mudar de ideia, é só nos avisar. Obrigado! 👍');
            }
            // End flow fully
            session.state = 'IDLE';
            session.currentNodeId = '';
            session.waitingForInput = false;
            return;
        }
        else if (clientCheck.rows.length === 0) {
            // Primeiro contato! Exige cadastro de nome
            session.state = 'ACTIVE';
            session.currentNodeId = 'register_client';
            session.waitingForInput = true;
            await sendTextMessage(sock, phone, `Olá! Seja bem-vindo! 💈\n\nIdentificamos que este é o seu primeiro contato conosco. Para continuarmos, *por favor digite seu nome completo*:`);
            return;
        }
        // Interceptação de múltiplos agendamentos
        if (session.currentNodeId === 'multiple_bookings_menu') {
            let option = text.toLowerCase().trim();
            const list = session.tempBookingsList || [];
            if (option === 'x' || option.includes('cancelar todos') || option.includes('cancelar tudo')) {
                if (list.length === 0) {
                    await sendTextMessage(sock, phone, `Desculpe, ocorreu um erro ao localizar seus agendamentos.`);
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                const ids = list.map(b => b.id);
                const now = new Date();
                const targetBookings = await db_1.default.query(`SELECT a.id, a.appointment_time, b.name as barber_name FROM appointments a JOIN users b ON a.barber_id = b.id WHERE a.id = ANY($1)`, [ids]);
                let cancelledCount = 0;
                let errorCount = 0;
                for (const appt of targetBookings.rows) {
                    const apptTime = new Date(appt.appointment_time);
                    const diffHours = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);
                    if (diffHours < 2) {
                        errorCount++;
                    }
                    else {
                        await db_1.default.query("UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Cancelado em lote via Bot' WHERE id = $1", [appt.id]);
                        cancelledCount++;
                    }
                }
                let responseText = '';
                if (cancelledCount > 0) {
                    responseText += `✅ *${cancelledCount} agendamento(s) cancelado(s)* com sucesso.\n`;
                }
                if (errorCount > 0) {
                    responseText += `⚠️ *${errorCount} agendamento(s)* não puderam ser cancelados porque restam menos de *2 horas* para o horário. Entre em contato direto com a barbearia para suporte nesses casos.\n`;
                }
                responseText += `\nObrigado! Qualquer dúvida, estamos à disposição.`;
                await sendTextMessage(sock, phone, responseText);
                session.state = 'IDLE';
                session.currentNodeId = '';
                session.waitingForInput = false;
                session.tempBookingsList = [];
                return;
            }
            else if (option === 'm' || option.includes('manter')) {
                await sendTextMessage(sock, phone, `Perfeito! Seus agendamentos futuros foram mantidos. Esperamos você lá! 💈`);
                session.state = 'IDLE';
                session.currentNodeId = '';
                session.waitingForInput = false;
                session.tempBookingsList = [];
                return;
            }
            else {
                const index = parseInt(option, 10) - 1;
                if (!isNaN(index) && index >= 0 && index < list.length) {
                    const selectedAppt = list[index];
                    session.activeBookingId = selectedAppt.id;
                    session.currentNodeId = 'existing_booking_menu';
                    const apptTime = new Date(selectedAppt.appointment_time);
                    const dateLabel = apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                    const timeLabel = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                    const menuText = `Selecionado: Horário do dia *${dateLabel}* às *${timeLabel}* com o profissional *${selectedAppt.barber_name}*.\n\nComo deseja proceder?\n\n1️⃣ *Manter Agendamento*\n2️⃣ *Remarcar Horário*\n3️⃣ *Cancelar Agendamento*\n\n_Por favor, responda apenas com o número da opção desejada (1, 2 ou 3)._`;
                    await sendTextMessage(sock, phone, menuText);
                    return;
                }
                else {
                    // Opção inválida, refaz a pergunta
                    let menuText = `⚠️ *Opção inválida.* Vimos que você tem *${list.length} agendamentos* futuros:\n\n`;
                    list.forEach((appt, idx) => {
                        const apptTime = new Date(appt.appointment_time);
                        const dateLabel = apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                        const timeLabel = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                        menuText += `${idx + 1}️⃣ *${dateLabel} às ${timeLabel}* com *${appt.barber_name}*\n`;
                    });
                    menuText += `\n*Como deseja proceder?*\n\n`;
                    menuText += `👉 Digite o número correspondente (ex: *1*, *2*) se deseja gerenciar (manter/remarcar/cancelar) aquele horário específico.\n`;
                    menuText += `👉 Digite *X* para *Cancelar Todos* os horários de uma vez.\n`;
                    menuText += `👉 Digite *M* para *Manter Todos* os horários e sair.`;
                    await sendTextMessage(sock, phone, menuText);
                    return;
                }
            }
        }
        // Interceptação de Respostas do menu de Agendamento Existente
        if (session.currentNodeId === 'existing_booking_menu') {
            let option = text.toLowerCase().trim();
            if (option === '1' || option.includes('manter')) {
                await sendTextMessage(sock, phone, `Perfeito! Seu agendamento está mantido e confirmado. Esperamos você lá! 💈`);
                session.state = 'IDLE';
                session.currentNodeId = '';
                session.waitingForInput = false;
                return;
            }
            else if (option === '2' || option.includes('remarcar')) {
                const apptId = session.activeBookingId;
                if (!apptId) {
                    await sendTextMessage(sock, phone, `Desculpe, ocorreu um erro ao localizar seu agendamento.`);
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                const apptRes = await db_1.default.query(`SELECT a.appointment_time, b.name as barber_name, c.name as client_name
           FROM appointments a
           JOIN users b ON a.barber_id = b.id
           JOIN clients c ON a.client_id = c.id
           WHERE a.id = $1`, [apptId]);
                if (apptRes.rows.length === 0) {
                    await sendTextMessage(sock, phone, `Desculpe, seu agendamento não foi localizado.`);
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                const appt = apptRes.rows[0];
                const apptTime = new Date(appt.appointment_time);
                const now = new Date();
                const diffHours = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);
                if (diffHours < 2) {
                    await sendTextMessage(sock, phone, `⚠️ *Atenção:* Desculpe, não é possível cancelar ou remarcar agendamentos com menos de *2 horas* de antecedência.\n\nSeu horário está agendado para o dia *${apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}* às *${apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}*.\n\nPor favor, entre em contato direto com a barbearia para suporte.`);
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                await db_1.default.query(`UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Reagendamento via Bot' WHERE id = $1`, [apptId]);
                await sendTextMessage(sock, phone, `Certo! Cancelamos o seu horário anterior com o profissional *${appt.barber_name}* para que você possa escolher um novo. Vamos iniciar um novo agendamento!`);
                session.state = 'ACTIVE';
                session.currentNodeId = 'welcome';
                session.waitingForInput = false;
                // Permite cair no fluxo normal de renderização do grafo abaixo
            }
            else if (option === '3' || option.includes('cancelar')) {
                const apptId = session.activeBookingId;
                if (!apptId) {
                    await sendTextMessage(sock, phone, `Desculpe, ocorreu um erro ao localizar seu agendamento.`);
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                const apptRes = await db_1.default.query(`SELECT a.appointment_time, b.name as barber_name, c.name as client_name
           FROM appointments a
           JOIN users b ON a.barber_id = b.id
           JOIN clients c ON a.client_id = c.id
           WHERE a.id = $1`, [apptId]);
                if (apptRes.rows.length === 0) {
                    await sendTextMessage(sock, phone, `Desculpe, seu agendamento não foi localizado.`);
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                const appt = apptRes.rows[0];
                const apptTime = new Date(appt.appointment_time);
                const now = new Date();
                const diffHours = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);
                if (diffHours < 2) {
                    await sendTextMessage(sock, phone, `⚠️ *Atenção:* Desculpe, não é possível cancelar ou remarcar agendamentos com menos de *2 horas* de antecedência.\n\nSeu horário está agendado para o dia *${apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}* às *${apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}*.\n\nPor favor, entre em contato direto com a barbearia para suporte.`);
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                await db_1.default.query(`UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Cancelado via Bot' WHERE id = $1`, [apptId]);
                await sendTextMessage(sock, phone, `Seu agendamento para o dia *${apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}* às *${apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}* foi cancelado com sucesso. Se quiser marcar um novo horário no futuro, basta nos enviar uma mensagem! Obrigado!`);
                session.state = 'IDLE';
                session.currentNodeId = '';
                session.waitingForInput = false;
                return;
            }
            else {
                const apptId = session.activeBookingId;
                if (!apptId) {
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                const apptRes = await db_1.default.query(`SELECT a.appointment_time, b.name as barber_name
           FROM appointments a
           JOIN users b ON a.barber_id = b.id
           WHERE a.id = $1`, [apptId]);
                if (apptRes.rows.length === 0) {
                    session.state = 'IDLE';
                    session.currentNodeId = '';
                    session.waitingForInput = false;
                    return;
                }
                const appt = apptRes.rows[0];
                const apptTime = new Date(appt.appointment_time);
                const dateLabel = apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const timeLabel = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                const menuText = `⚠️ Opção inválida. Como deseja proceder?\n\n1️⃣ *Manter Agendamento*\n2️⃣ *Remarcar Horário*\n3️⃣ *Cancelar Agendamento*\n\n_Por favor, responda apenas com o número da opção desejada (1, 2 ou 3)._`;
                await sendTextMessage(sock, phone, menuText);
                return;
            }
        }
        // Interceptação inicial
        if (session.state === 'IDLE' || !session.currentNodeId) {
            const existingBookings = await db_1.default.query(`SELECT a.id, a.appointment_time, b.name as barber_name 
         FROM appointments a
         JOIN clients c ON a.client_id = c.id
         JOIN users b ON a.barber_id = b.id
         WHERE c.phone = $1 AND a.establishment_id = $2 AND a.appointment_time > NOW() AND a.status = 'confirmed'
         ORDER BY a.appointment_time ASC`, [cleanPhone, establishmentId]);
            if (existingBookings.rows.length === 1) {
                const appt = existingBookings.rows[0];
                const apptTime = new Date(appt.appointment_time);
                const dateLabel = apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const timeLabel = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                session.state = 'ACTIVE';
                session.currentNodeId = 'existing_booking_menu';
                session.waitingForInput = true;
                session.activeBookingId = appt.id;
                const menuText = `Olá! Vimos que você já tem um agendamento marcado para o dia *${dateLabel}* às *${timeLabel}* com o profissional *${appt.barber_name}*.\n\nComo deseja proceder?\n\n1️⃣ *Manter Agendamento*\n2️⃣ *Remarcar Horário*\n3️⃣ *Cancelar Agendamento*\n\n_Por favor, responda apenas com o número da opção desejada (1, 2 ou 3)._`;
                await sendTextMessage(sock, phone, menuText);
                return;
            }
            else if (existingBookings.rows.length > 1) {
                session.state = 'ACTIVE';
                session.currentNodeId = 'multiple_bookings_menu';
                session.waitingForInput = true;
                session.tempBookingsList = existingBookings.rows;
                let menuText = `Olá! Vimos que você tem *${existingBookings.rows.length} agendamentos* futuros marcados:\n\n`;
                existingBookings.rows.forEach((appt, idx) => {
                    const apptTime = new Date(appt.appointment_time);
                    const dateLabel = apptTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                    const timeLabel = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                    menuText += `${idx + 1}️⃣ *${dateLabel} às ${timeLabel}* com *${appt.barber_name}*\n`;
                });
                menuText += `\n*Como deseja proceder?*\n\n`;
                menuText += `👉 Digite o número correspondente (ex: *1*, *2*) se deseja gerenciar (manter/remarcar/cancelar) aquele horário específico.\n`;
                menuText += `👉 Digite *X* para *Cancelar Todos* os horários de uma vez.\n`;
                menuText += `👉 Digite *M* para *Manter Todos* os horários e sair.`;
                await sendTextMessage(sock, phone, menuText);
                return;
            }
        }
        // 1. Fetch the establishment's bot_flow and parameters from DB
        const estRes = await db_1.default.query(`SELECT name, opening_time, closing_time, msg_fallback, bot_flow 
       FROM establishments WHERE id = $1`, [establishmentId]);
        if (estRes.rows.length === 0)
            return;
        const est = estRes.rows[0];
        session.establishmentName = est.name;
        session.establishmentOpening = est.opening_time.substring(0, 5);
        session.establishmentClosing = est.closing_time.substring(0, 5);
        session.msg_fallback = est.msg_fallback;
        const botFlow = est.bot_flow;
        if (!botFlow || !botFlow.nodes || !botFlow.edges) {
            console.warn(`[SessionManager] Bot flow config missing for establishment ${establishmentId}`);
            return;
        }
        const nodes = botFlow.nodes;
        const edges = botFlow.edges;
        const fallbackReply = session.msg_fallback || 'Opção inválida. Digite novamente:';
        // If starting fresh or session got reset, find the target node connected to the Start node
        if (session.state === 'IDLE' || !session.currentNodeId) {
            session.state = 'ACTIVE';
            const startNode = nodes.find(n => n.type === 'start' || n.id === 'start');
            const startEdge = edges.find(e => e.source === (startNode?.id || 'start'));
            session.currentNodeId = startEdge ? startEdge.target : 'welcome';
            session.waitingForInput = false;
        }
        // Traverse the graph nodes
        let loopCount = 0;
        while (loopCount < 10) { // Safety limit to prevent infinite graph loop crashes
            loopCount++;
            const node = nodes.find(n => n.id === session.currentNodeId);
            if (!node || node.type === 'end' || node.id === 'end') {
                // Reset session to IDLE and stop
                session.state = 'IDLE';
                session.currentNodeId = '';
                session.waitingForInput = false;
                return;
            }
            // STATE A: We are waiting for client input to evaluate the current node
            if (session.waitingForInput) {
                if (node.type === 'message') {
                    // If the message node points to a condition node, evaluate condition!
                    const edgeToCondition = edges.find(e => e.source === node.id && nodes.find(n => n.id === e.target)?.type === 'condition');
                    if (edgeToCondition) {
                        const conditionNode = nodes.find(n => n.id === edgeToCondition.target);
                        let evaluatedText = text.trim();
                        if (session.lastConditionOptions) {
                            const matchedMap = session.lastConditionOptions.find(o => o.number === evaluatedText);
                            if (matchedMap) {
                                evaluatedText = matchedMap.key;
                            }
                        }
                        const matchedOption = conditionNode.options?.find((opt) => opt.key === evaluatedText ||
                            opt.key.toLowerCase() === evaluatedText.toLowerCase() ||
                            (opt.label && opt.label.toLowerCase() === evaluatedText.toLowerCase()));
                        if (matchedOption) {
                            session.currentNodeId = matchedOption.target;
                            session.waitingForInput = false;
                            continue; // Jump to the target node
                        }
                        else {
                            await sendTextMessage(sock, phone, fallbackReply);
                            return; // Stop and wait for a valid option
                        }
                    }
                    // If it just points to another node directly without condition, transition
                    const directEdge = edges.find(e => e.source === node.id);
                    if (directEdge) {
                        session.currentNodeId = directEdge.target;
                        session.waitingForInput = false;
                        continue;
                    }
                    // No target? End flow
                    session.state = 'IDLE';
                    return;
                }
                if (node.type === 'action') {
                    if (node.actionType === 'select_barber') {
                        let selectedBarber = null;
                        if (session.barbersList) {
                            const option = parseInt(text, 10);
                            if (!isNaN(option) && option >= 1 && option <= session.barbersList.length) {
                                selectedBarber = session.barbersList[option - 1];
                            }
                            else {
                                selectedBarber = session.barbersList.find(b => b.name.toLowerCase().trim() === text.toLowerCase().trim());
                            }
                        }
                        if (!selectedBarber) {
                            await sendTextMessage(sock, phone, fallbackReply);
                            return;
                        }
                        session.selectedBarberId = selectedBarber.id;
                        session.selectedBarberName = selectedBarber.name;
                        // Transition to target edge
                        const edge = edges.find(e => e.source === node.id);
                        if (edge) {
                            session.currentNodeId = edge.target;
                            session.waitingForInput = false;
                            continue;
                        }
                    }
                    if (node.actionType === 'select_date') {
                        let selectedDay = null;
                        if (session.datesList) {
                            const option = parseInt(text, 10);
                            if (!isNaN(option) && option >= 1 && option <= session.datesList.length) {
                                selectedDay = session.datesList[option - 1];
                            }
                            else {
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
                            continue;
                        }
                    }
                    if (node.actionType === 'select_slot') {
                        let selectedSlotISO = null;
                        if (session.slotsList) {
                            const option = parseInt(text, 10);
                            if (!isNaN(option) && option >= 1 && option <= session.slotsList.length) {
                                selectedSlotISO = session.slotsList[option - 1];
                            }
                            else {
                                selectedSlotISO = session.slotsList.find(slotStr => formatTime(slotStr) === text.trim());
                            }
                        }
                        if (!selectedSlotISO) {
                            await sendTextMessage(sock, phone, fallbackReply);
                            return;
                        }
                        session.selectedSlotISO = selectedSlotISO;
                        // Save booking in PostgreSQL
                        const clientDb = await db_1.default.connect();
                        try {
                            await clientDb.query('BEGIN');
                            const cleanPhone = phone.split('@')[0];
                            let clientId;
                            const clientCheck = await clientDb.query('SELECT id FROM clients WHERE phone = $1 AND establishment_id = $2', [cleanPhone, establishmentId]);
                            if (clientCheck.rows.length > 0) {
                                clientId = clientCheck.rows[0].id;
                            }
                            else {
                                const clientRes = await clientDb.query('INSERT INTO clients (establishment_id, name, phone) VALUES ($1, $2, $3) RETURNING id', [establishmentId, pushName, cleanPhone]);
                                clientId = clientRes.rows[0].id;
                            }
                            // Double check availability
                            const doubleBookCheck = await clientDb.query(`SELECT id FROM appointments 
                 WHERE barber_id = $1 AND appointment_time = $2 AND status != 'cancelled'`, [session.selectedBarberId, selectedSlotISO]);
                            if (doubleBookCheck.rows.length > 0) {
                                await clientDb.query('ROLLBACK');
                                await sendTextMessage(sock, phone, 'Desculpe, esse horário foi reservado há poucos instantes por outro cliente. Reiniciando...');
                                session.state = 'IDLE';
                                return;
                            }
                            // Resolve default service for the establishment (first active service)
                            const serviceQuery = await clientDb.query('SELECT id FROM services WHERE establishment_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1', [establishmentId]);
                            const defaultServiceId = serviceQuery.rows.length > 0 ? serviceQuery.rows[0].id : null;
                            await clientDb.query(`INSERT INTO appointments (establishment_id, barber_id, client_id, service_id, appointment_time, status)
                 VALUES ($1, $2, $3, $4, $5, 'confirmed')`, [establishmentId, session.selectedBarberId, clientId, defaultServiceId, selectedSlotISO]);
                            await clientDb.query('COMMIT');
                            // Proceed to next node (usually confirmed message)
                            const edge = edges.find(e => e.source === node.id);
                            if (edge) {
                                session.currentNodeId = edge.target;
                                session.waitingForInput = false;
                                continue;
                            }
                        }
                        catch (dbErr) {
                            await clientDb.query('ROLLBACK');
                            console.error('Bot flow DB error:', dbErr);
                            await sendTextMessage(sock, phone, 'Erro ao registrar agendamento. Tente novamente mais tarde.');
                            session.state = 'IDLE';
                            return;
                        }
                        finally {
                            clientDb.release();
                        }
                    }
                    if (node.actionType === 'offer_plan') {
                        let option = parseInt(text, 10);
                        if (isNaN(option)) {
                            if (text.toLowerCase().includes('quinzenal')) {
                                option = 1;
                            }
                            else if (text.toLowerCase().includes('mensal')) {
                                option = 2;
                            }
                            else if (text.toLowerCase().includes('não') || text.toLowerCase().includes('nao') || text.toLowerCase().includes('obrigado')) {
                                option = 3;
                            }
                        }
                        if (option === 1 || option === 2) {
                            const planType = option === 1 ? 'quinzenal' : 'mensal';
                            const cleanPhone = phone.split('@')[0];
                            const clientQuery = await db_1.default.query('SELECT id, name FROM clients WHERE phone = $1 AND establishment_id = $2', [cleanPhone, establishmentId]);
                            if (clientQuery.rows.length > 0 && session.selectedSlotISO) {
                                const clientId = clientQuery.rows[0].id;
                                const slotDate = new Date(session.selectedSlotISO);
                                const preferredTime = `${String(slotDate.getHours()).padStart(2, '0')}:${String(slotDate.getMinutes()).padStart(2, '0')}:00`;
                                const preferredDayOfWeek = slotDate.getDay();
                                const clientDb = await db_1.default.connect();
                                try {
                                    await clientDb.query('BEGIN');
                                    await clientDb.query(`INSERT INTO client_plans (establishment_id, client_id, barber_id, plan_type, preferred_time, preferred_day_of_week, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6, true)
                     ON CONFLICT (client_id, establishment_id)
                     DO UPDATE SET plan_type = EXCLUDED.plan_type, 
                                   preferred_time = EXCLUDED.preferred_time,
                                   preferred_day_of_week = EXCLUDED.preferred_day_of_week`, [establishmentId, clientId, session.selectedBarberId, planType, preferredTime, preferredDayOfWeek]);
                                    await (0, planController_1.generateFutureBookingsForPlan)(clientDb, establishmentId, clientId, session.selectedBarberId, planType, preferredTime, preferredDayOfWeek);
                                    await clientDb.query('COMMIT');
                                    await sendTextMessage(sock, phone, `🎉 *Excelente!* Seu Plano *${planType === 'quinzenal' ? 'Quinzenal' : 'Mensal'}* foi ativo e seus próximos horários já estão reservados! Enviaremos lembretes. Obrigado! 👍`);
                                }
                                catch (e) {
                                    await clientDb.query('ROLLBACK');
                                    console.error(e);
                                }
                                finally {
                                    clientDb.release();
                                }
                            }
                        }
                        else if (option === 3 || text.toLowerCase() === 'não' || text.toLowerCase() === 'nao') {
                            await sendTextMessage(sock, phone, 'Perfeito! Esperamos você no dia marcado. Obrigado!');
                        }
                        else {
                            await sendTextMessage(sock, phone, 'Opção inválida. Responda 1 (Quinzenal), 2 (Mensal) ou 3 (Não).');
                            return;
                        }
                        // Transition to promotions subscription prompt
                        session.state = 'ACTIVE';
                        session.currentNodeId = 'ask_promotions';
                        session.waitingForInput = true;
                        await sendTextMessage(sock, phone, `📲 *Última pergunta:* Gostaria de receber novidades, avisos de horários e promoções exclusivas da nossa barbearia diretamente pelo WhatsApp?\n\n1️⃣ *Sim, por favor!*\n2️⃣ *Não, obrigado.*`);
                        return;
                    }
                }
            }
            // STATE B: We need to render the prompt/text for the current node
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
                    // Check if there is an edge leading to a condition node
                    const edgeToCondition = edges.find(e => e.source === node.id && nodes.find(n => n.id === e.target)?.type === 'condition');
                    if (edgeToCondition) {
                        const conditionNode = nodes.find(n => n.id === edgeToCondition.target);
                        if (conditionNode && conditionNode.options && conditionNode.options.length > 0) {
                            let menuText = replaced + '\n';
                            conditionNode.options.forEach((opt, idx) => {
                                menuText += `\n*${idx + 1}* - ${opt.label || opt.key}`;
                            });
                            menuText += '\n\n_Por favor, responda apenas com o número correspondente._';
                            await sendTextMessage(sock, phone, menuText);
                            session.lastConditionOptions = conditionNode.options.map((opt, idx) => ({
                                number: String(idx + 1),
                                key: opt.key
                            }));
                            session.waitingForInput = true; // Stop and wait for client reply to evaluate condition
                            return;
                        }
                    }
                    await sendTextMessage(sock, phone, replaced);
                    // Check if there is a direct target edge to jump to immediately
                    const directEdge = edges.find(e => e.source === node.id);
                    if (directEdge) {
                        session.currentNodeId = directEdge.target;
                        continue;
                    }
                    // No target, end flow
                    session.state = 'IDLE';
                    return;
                }
                if (node.type === 'condition') {
                    // Condition nodes are not rendered themselves; they evaluate input from parent.
                    // If we landed here without waitingForInput, it means the flow is misconfigured. Jump to welcome.
                    session.currentNodeId = 'welcome';
                    continue;
                }
                if (node.type === 'action') {
                    if (node.actionType === 'select_barber') {
                        const barbersRes = await db_1.default.query(`SELECT id, name FROM users WHERE establishment_id = $1 AND role = 'barber' AND is_active = true ORDER BY name ASC`, [establishmentId]);
                        if (barbersRes.rows.length === 0) {
                            await sendTextMessage(sock, phone, 'Desculpe, no momento não temos profissionais cadastrados.');
                            session.state = 'IDLE';
                            return;
                        }
                        session.barbersList = barbersRes.rows;
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
                        return;
                    }
                    if (node.actionType === 'select_slot') {
                        // Fetch barber opening hours config
                        const estRes = await db_1.default.query('SELECT opening_time, closing_time, slot_duration_minutes FROM establishments WHERE id = $1', [establishmentId]);
                        const { opening_time, closing_time, slot_duration_minutes } = estRes.rows[0];
                        // Fetch booked slots
                        const appRes = await db_1.default.query(`SELECT appointment_time 
               FROM appointments 
               WHERE barber_id = $1 AND DATE(appointment_time AT TIME ZONE 'UTC') = $2 AND status != 'cancelled'`, [session.selectedBarberId, session.selectedDateStr]);
                        const bookedTimes = appRes.rows.map((row) => new Date(row.appointment_time).getTime());
                        // Generate slots
                        const allSlots = [];
                        const start = new Date(`${session.selectedDateStr}T${opening_time}`);
                        const end = new Date(`${session.selectedDateStr}T${closing_time}`);
                        let current = new Date(start);
                        while (current < end) {
                            allSlots.push(new Date(current));
                            current.setMinutes(current.getMinutes() + slot_duration_minutes);
                        }
                        const now = new Date();
                        const availableSlots = allSlots.filter((slot) => {
                            if (slot.getTime() <= now.getTime())
                                return false;
                            const isBooked = bookedTimes.some((booked) => Math.abs(booked - slot.getTime()) < 60000);
                            return !isBooked;
                        });
                        if (availableSlots.length === 0) {
                            await sendTextMessage(sock, phone, `Desculpe, sem horários livres para ${session.selectedBarberName} no dia ${session.selectedDateLabel}. Digite outra data para tentar novamente:`);
                            // Go back to select date node
                            const selectDateNode = nodes.find(n => n.actionType === 'select_date');
                            if (selectDateNode) {
                                session.currentNodeId = selectDateNode.id;
                                session.waitingForInput = false; // Trigger reload date prompt
                                continue;
                            }
                            session.state = 'IDLE';
                            return;
                        }
                        const slotsToShow = availableSlots.slice(0, 12);
                        session.slotsList = slotsToShow.map(s => s.toISOString());
                        const templateText = est.msg_select_slot || 'Escolha um horário com *{barbeiro}* para {data}:';
                        const titleText = replacePlaceholders(templateText, {
                            barbeiro: session.selectedBarberName,
                            data: session.selectedDateLabel,
                            horarios: ''
                        }).replace(/\n+/g, '\n').trim();
                        let menuText = `🕒 ${titleText || 'Escolha um horário:'}\n`;
                        slotsToShow.forEach((slot, idx) => {
                            menuText += `\n*${idx + 1}* - ${formatTime(slot.toISOString())}`;
                        });
                        menuText += '\n\n_Por favor, responda apenas com o número desejado (ex: 1)._';
                        await sendTextMessage(sock, phone, menuText);
                        session.waitingForInput = true;
                        return;
                    }
                    if (node.actionType === 'offer_plan') {
                        // Check if client already has an active plan
                        const cleanPhone = phone.split('@')[0];
                        const planCheck = await db_1.default.query(`SELECT p.plan_type 
               FROM client_plans p
               JOIN clients c ON p.client_id = c.id
               WHERE c.phone = $1 AND p.establishment_id = $2 AND p.is_active = true`, [cleanPhone, establishmentId]);
                        if (planCheck.rows.length > 0) {
                            const activePlan = planCheck.rows[0].plan_type;
                            await sendTextMessage(sock, phone, `Perfeito! Como você já possui o plano *${activePlan === 'quinzenal' ? 'Quinzenal' : 'Mensal'}* ativo, seus próximos horários já estão reservados de forma recorrente! Esperamos você no dia marcado. Obrigado! 💈`);
                            // Proceed to next node or finish flow
                            const edge = edges.find(e => e.source === node.id);
                            if (edge) {
                                session.currentNodeId = edge.target;
                                session.waitingForInput = false;
                                continue;
                            }
                            else {
                                session.state = 'IDLE';
                                return;
                            }
                        }
                        const titleText = `💈 *Clube de Assinatura da Barbearia*\n\nGostaria de aderir a um plano recorrente para garantir seu corte sempre no mesmo dia e horário?`;
                        const menuText = `${titleText}\n\n1️⃣ *Plano Quinzenal*\n2️⃣ *Plano Mensal*\n3️⃣ *Não, obrigado*\n\n_Por favor, responda apenas com o número da opção desejada (1, 2 ou 3)._`;
                        await sendTextMessage(sock, phone, menuText);
                        session.waitingForInput = true;
                        return;
                    }
                }
            }
        }
    }
    catch (error) {
        console.error('WhatsApp Multitenant Graph Bot Flow error:', error);
        if (sock) {
            await sendTextMessage(sock, phone, 'Desculpe, ocorreu um erro interno ao processar a mensagem.');
        }
        session.state = 'IDLE';
    }
}
async function getActiveChats(establishmentId) {
    // 1. Fetch all persistent mappings from database to ensure complete coverage
    let localLidMap = new Map();
    try {
        const mappingsRes = await db_1.default.query("SELECT lid, phone FROM lid_mappings");
        for (const row of mappingsRes.rows) {
            localLidMap.set(row.lid, row.phone);
        }
    }
    catch (err) {
        console.error('[getActiveChats] Failed to fetch lid_mappings:', err);
    }
    // Also merge with in-memory map
    for (const [lid, phone] of lidToPhoneMap.entries()) {
        const cleanLid = lid.split('@')[0];
        const cleanPhone = phone.split('@')[0];
        localLidMap.set(cleanLid, cleanPhone);
    }
    const unifiedChats = new Map();
    for (const [key, session] of botSessions.entries()) {
        const parts = key.split('_');
        const phone = parts[0];
        const estId = parts.slice(1).join('_');
        if (estId !== establishmentId)
            continue;
        const realPhone = localLidMap.get(phone) || phone;
        const existing = unifiedChats.get(realPhone) || {
            phone: realPhone,
            state: 'IDLE',
            currentNodeId: 'welcome',
            waitingForInput: false,
            clientPushName: 'Cliente',
            selectedBarberName: undefined,
            selectedDateLabel: undefined,
            selectedSlotISO: undefined,
            messages: []
        };
        // Merge data from this session
        if (session.state !== 'IDLE') {
            existing.state = session.state;
        }
        if (session.currentNodeId && session.currentNodeId !== 'welcome') {
            existing.currentNodeId = session.currentNodeId;
        }
        if (session.waitingForInput) {
            existing.waitingForInput = session.waitingForInput;
        }
        if (session.clientPushName && session.clientPushName !== 'Cliente') {
            existing.clientPushName = session.clientPushName;
        }
        if (session.selectedBarberName) {
            existing.selectedBarberName = session.selectedBarberName;
        }
        if (session.selectedDateLabel) {
            existing.selectedDateLabel = session.selectedDateLabel;
        }
        if (session.selectedSlotISO) {
            existing.selectedSlotISO = session.selectedSlotISO;
        }
        // Append and sort messages
        if (session.messages) {
            existing.messages = [...existing.messages, ...session.messages];
        }
        unifiedChats.set(realPhone, existing);
    }
    // De-duplicate and keep message order
    const chatsList = Array.from(unifiedChats.values());
    for (const chat of chatsList) {
        const seenMsgs = new Set();
        chat.messages = chat.messages.filter((msg) => {
            const msgKey = `${msg.fromMe}_${msg.text}_${msg.time}`;
            if (seenMsgs.has(msgKey))
                return false;
            seenMsgs.add(msgKey);
            return true;
        });
    }
    // 3. Resolve client names from DB (clients table) to prioritize manually edited names
    const cleanPhonesList = chatsList.map(c => c.phone.split('@')[0]);
    if (cleanPhonesList.length > 0) {
        try {
            const dbClients = await db_1.default.query("SELECT phone, name FROM clients WHERE establishment_id = $1 AND phone = ANY($2)", [establishmentId, cleanPhonesList]);
            const clientNamesMap = new Map();
            for (const row of dbClients.rows) {
                clientNamesMap.set(row.phone, row.name);
            }
            for (const chat of chatsList) {
                const cleanChatPhone = chat.phone.split('@')[0];
                const dbName = clientNamesMap.get(cleanChatPhone);
                if (dbName) {
                    chat.clientPushName = dbName;
                }
            }
        }
        catch (dbErr) {
            console.error('[getActiveChats] Failed to query client names from DB:', dbErr);
        }
    }
    return chatsList;
}
function pauseChatBot(establishmentId, phone) {
    const session = getBotSession(phone, establishmentId);
    session.state = 'PAUSED';
    return true;
}
function resumeChatBot(establishmentId, phone) {
    const session = getBotSession(phone, establishmentId);
    session.state = 'IDLE';
    session.currentNodeId = 'welcome';
    session.waitingForInput = false;
    return true;
}
function terminateChatSession(establishmentId, phone) {
    const normalized = normalizeJid(phone);
    const key = `${normalized}_${establishmentId}`;
    botSessions.delete(key);
    return true;
}
async function sendManualMessage(establishmentId, phone, text) {
    const sock = activeSockets.get(establishmentId);
    if (!sock) {
        throw new Error('Sem sessão ativa do WhatsApp para este estabelecimento.');
    }
    const normalized = normalizeJid(phone);
    const sanitized = sanitizeMessageText(text);
    const sentMsg = await sock.sendMessage(normalized, { text: sanitized });
    const realJid = normalizeJid(sentMsg?.key?.remoteJid || normalized);
    const session = getBotSession(realJid, establishmentId);
    session.state = 'PAUSED';
    addSessionMessage(session, text, true);
    if (realJid.endsWith('@lid') && !normalized.includes('@')) {
        lidToPhoneMap.set(realJid, normalized.replace(/\D/g, ''));
    }
    if (realJid !== normalized) {
        const oldKey = `${normalized}_${establishmentId}`;
        botSessions.delete(oldKey);
    }
    return realJid;
}
function getActiveSessionsList() {
    const list = [];
    for (const [estId, socket] of activeSockets.entries()) {
        list.push({
            establishmentId: estId,
            status: socket.user ? 'CONNECTED' : 'DISCONNECTED',
            phone: socket.user?.id ? (0, baileys_1.jidNormalizedUser)(socket.user.id) : undefined
        });
    }
    return list;
}
async function resolveLidRetroactively(lidJid, realPhone) {
    const normalizedLid = normalizeJid(lidJid);
    const normalizedReal = normalizeJid(realPhone);
    const lidNumber = normalizedLid.split('@')[0];
    const realNumber = normalizedReal.split('@')[0];
    if (lidNumber === realNumber)
        return;
    // Cache in the map
    lidToPhoneMap.set(lidJid, realNumber);
    lidToPhoneMap.set(`${lidNumber}@lid`, realNumber);
    console.log(`[LidResolver] Resolution discovered: ${lidNumber} -> ${realNumber}. Updating databases retroactively...`);
    try {
        // 0. Save the mapping to lid_mappings table
        await db_1.default.query(`INSERT INTO lid_mappings (lid, phone) VALUES ($1, $2)
       ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone`, [lidNumber, realNumber]);
        // 1. Update appointments
        await db_1.default.query("UPDATE appointments SET client_phone = $1 WHERE client_phone = $2", [realNumber, lidNumber]);
        // 2. Update clients
        await db_1.default.query("UPDATE clients SET phone = $1 WHERE phone = $2", [realNumber, lidNumber]);
        // 3. Update memory botSessions chats keys
        for (const [key, session] of botSessions.entries()) {
            const parts = key.split('_');
            const phone = parts[0];
            const estId = parts.slice(1).join('_');
            if (phone === lidNumber) {
                const newKey = `${realNumber}_${estId}`;
                botSessions.delete(key);
                botSessions.set(newKey, session);
                console.log(`[LidResolver] Updated botSession cache key from ${key} to ${newKey}`);
            }
        }
    }
    catch (err) {
        console.error('[LidResolver] Retroactive resolution failed:', err);
    }
}
