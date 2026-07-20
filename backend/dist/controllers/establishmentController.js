"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEstablishments = exports.updateEstablishment = exports.getEstablishmentBySlug = exports.getEstablishment = void 0;
const db_1 = __importDefault(require("../config/db"));
// Get establishment details (Authenticated)
const getEstablishment = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT id, name, slug, primary_color, secondary_color, background_color, text_color, 
              opening_time, closing_time, slot_duration_minutes, 
              msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback,
              bot_flow, logo_url, address, bio,
              created_at 
       FROM establishments 
       WHERE id = $1`, [establishmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Establishment not found.' });
        }
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Get establishment error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.getEstablishment = getEstablishment;
// Get establishment details by Slug (Public - used by frontend to dynamic-theme and customize login page)
const getEstablishmentBySlug = async (req, res) => {
    const { slug } = req.params;
    try {
        const result = await db_1.default.query(`SELECT id, name, slug, primary_color, secondary_color, background_color, text_color, 
              opening_time, closing_time, slot_duration_minutes, 
              msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback,
              bot_flow, logo_url, address, bio, is_active
       FROM establishments 
       WHERE slug = $1`, [slug]);
        if (result.rows.length === 0 || !result.rows[0].is_active || result.rows[0].id === '00000000-0000-0000-0000-000000000000') {
            return res.status(404).json({ error: 'Establishment not found or suspended.' });
        }
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Get establishment by slug error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.getEstablishmentBySlug = getEstablishmentBySlug;
// Update establishment config (Owner/Admin only)
const updateEstablishment = async (req, res) => {
    const { establishmentId } = req.params;
    const { name, primary_color, secondary_color, background_color, text_color, opening_time, closing_time, slot_duration_minutes, msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback, bot_flow, logo_url, address, bio } = req.body;
    try {
        const result = await db_1.default.query(`UPDATE establishments 
       SET name = $1, 
           primary_color = $2, 
           secondary_color = $3, 
           background_color = $4, 
           text_color = $5, 
           opening_time = $6, 
           closing_time = $7, 
           slot_duration_minutes = $8,
           msg_welcome = $9,
           msg_select_barber = $10,
           msg_select_date = $11,
           msg_select_slot = $12,
           msg_confirmed = $13,
           msg_fallback = $14,
           bot_flow = COALESCE($15::jsonb, bot_flow),
           logo_url = $16,
           address = $17,
           bio = $18
       WHERE id = $19
       RETURNING id, name, slug, primary_color, secondary_color, background_color, text_color, 
                 opening_time, closing_time, slot_duration_minutes,
                 msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback, bot_flow, logo_url, address, bio`, [
            name,
            primary_color,
            secondary_color,
            background_color,
            text_color,
            opening_time,
            closing_time,
            slot_duration_minutes,
            msg_welcome,
            msg_select_barber,
            msg_select_date,
            msg_select_slot,
            msg_confirmed,
            msg_fallback,
            bot_flow ? JSON.stringify(bot_flow) : null,
            logo_url,
            address,
            bio,
            establishmentId
        ]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Establishment not found.' });
        }
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Update establishment error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.updateEstablishment = updateEstablishment;
// List all establishments (Public - Landing Page)
const listEstablishments = async (req, res) => {
    try {
        const result = await db_1.default.query(`SELECT id, name, slug, logo_url, address, bio, primary_color, secondary_color, background_color, text_color 
       FROM establishments 
       WHERE is_active = TRUE AND id != '00000000-0000-0000-0000-000000000000'::uuid
       ORDER BY name ASC`);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('List establishments error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listEstablishments = listEstablishments;
