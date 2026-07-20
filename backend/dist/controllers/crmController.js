"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPromoCampaign = exports.updatePromoConfig = exports.getPromoConfig = exports.updateEstablishmentClient = exports.listEstablishmentClients = void 0;
const db_1 = __importDefault(require("../config/db"));
const whatsappManager_1 = require("../services/whatsappManager");
// 1. List clients of an establishment
const listEstablishmentClients = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT id, name, phone, notes, accept_promotions, created_at 
       FROM clients 
       WHERE establishment_id = $1 
       ORDER BY name ASC`, [establishmentId]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('[crmController] Error listing clients:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listEstablishmentClients = listEstablishmentClients;
// 2. Update client notes and preferences
const updateEstablishmentClient = async (req, res) => {
    const { establishmentId, clientId } = req.params;
    const { name, phone, notes, accept_promotions } = req.body;
    try {
        const result = await db_1.default.query(`UPDATE clients 
       SET name = $1, phone = $2, notes = $3, accept_promotions = $4
       WHERE id = $5 AND establishment_id = $6
       RETURNING *`, [name, phone, notes, accept_promotions, clientId, establishmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found.' });
        }
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('[crmController] Error updating client:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.updateEstablishmentClient = updateEstablishmentClient;
// 3. Get promotions delay configuration
const getPromoConfig = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT promo_delay_min_seconds, promo_delay_max_seconds 
       FROM establishments 
       WHERE id = $1`, [establishmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Establishment not found.' });
        }
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('[crmController] Error getting promo config:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.getPromoConfig = getPromoConfig;
// 4. Update promotions delay configuration
const updatePromoConfig = async (req, res) => {
    const { establishmentId } = req.params;
    const { promo_delay_min_seconds, promo_delay_max_seconds } = req.body;
    const minSec = parseInt(promo_delay_min_seconds, 10);
    const maxSec = parseInt(promo_delay_max_seconds, 10);
    if (isNaN(minSec) || isNaN(maxSec) || minSec < 1 || maxSec < minSec) {
        return res.status(400).json({ error: 'Valores de intervalo inválidos.' });
    }
    try {
        const result = await db_1.default.query(`UPDATE establishments 
       SET promo_delay_min_seconds = $1, promo_delay_max_seconds = $2
       WHERE id = $3
       RETURNING promo_delay_min_seconds, promo_delay_max_seconds`, [minSec, maxSec, establishmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Establishment not found.' });
        }
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('[crmController] Error updating promo config:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.updatePromoConfig = updatePromoConfig;
// 5. Send promotional campaign to all subscribed clients with anti-ban delay
const sendPromoCampaign = async (req, res) => {
    const { establishmentId } = req.params;
    const { text } = req.body;
    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Mensagem de promoção não pode ser vazia.' });
    }
    try {
        // 1. Get delay config
        const estRes = await db_1.default.query('SELECT promo_delay_min_seconds, promo_delay_max_seconds FROM establishments WHERE id = $1', [establishmentId]);
        if (estRes.rows.length === 0) {
            return res.status(404).json({ error: 'Establishment not found.' });
        }
        const { promo_delay_min_seconds, promo_delay_max_seconds } = estRes.rows[0];
        // 2. Get all promo-accepting clients
        const clientsRes = await db_1.default.query('SELECT phone, name FROM clients WHERE establishment_id = $1 AND accept_promotions = true', [establishmentId]);
        const targets = clientsRes.rows;
        if (targets.length === 0) {
            return res.status(400).json({ error: 'Nenhum cliente aceitou receber promoções até o momento.' });
        }
        // Respond immediately to the frontend
        res.json({
            message: 'Campanha de promoção iniciada com sucesso!',
            recipients_count: targets.length,
            estimated_seconds: targets.length * ((promo_delay_min_seconds + promo_delay_max_seconds) / 2)
        });
        // Run queue sender in background
        (async () => {
            console.log(`[CampaignRunner] Starting campaign for establishment ${establishmentId} with ${targets.length} targets...`);
            for (let i = 0; i < targets.length; i++) {
                const client = targets[i];
                const personalizedText = text.replace(/{cliente}/g, client.name);
                console.log(`[CampaignRunner] Sending promo to ${client.name} (${client.phone})...`);
                try {
                    await (0, whatsappManager_1.sendOrchestratedMessage)(String(establishmentId), client.phone, personalizedText);
                }
                catch (sendErr) {
                    console.error(`[CampaignRunner] Error sending to ${client.phone}:`, sendErr);
                }
                // Wait before next message if not the last one
                if (i < targets.length - 1) {
                    const minMs = promo_delay_min_seconds * 1000;
                    const maxMs = promo_delay_max_seconds * 1000;
                    const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
                    console.log(`[CampaignRunner] Waiting ${randomDelay / 1000} seconds before next message...`);
                    await new Promise(resolve => setTimeout(resolve, randomDelay));
                }
            }
            console.log(`[CampaignRunner] Campaign for ${establishmentId} finished.`);
        })().catch(err => {
            console.error('[CampaignRunner] Background error:', err);
        });
    }
    catch (error) {
        console.error('[crmController] Error starting campaign:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.sendPromoCampaign = sendPromoCampaign;
