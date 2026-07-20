import { Request, Response } from 'express';
import pool from '../config/db';
import { AuthenticatedRequest } from '../middleware/auth';

// Get establishment details (Authenticated)
export const getEstablishment = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, slug, primary_color, secondary_color, background_color, text_color, 
              opening_time, closing_time, slot_duration_minutes, 
              msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback,
              bot_flow, logo_url, address, bio,
              created_at 
       FROM establishments 
       WHERE id = $1`,
      [establishmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Get establishment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Get establishment details by Slug (Public - used by frontend to dynamic-theme and customize login page)
export const getEstablishmentBySlug = async (req: Request, res: Response) => {
  const { slug } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, slug, primary_color, secondary_color, background_color, text_color, 
              opening_time, closing_time, slot_duration_minutes, 
              msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback,
              bot_flow, logo_url, address, bio, is_active
       FROM establishments 
       WHERE slug = $1`,
      [slug]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active || result.rows[0].id === '00000000-0000-0000-0000-000000000000') {
      return res.status(404).json({ error: 'Establishment not found or suspended.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Get establishment by slug error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Update establishment config (Owner/Admin only)
export const updateEstablishment = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId } = req.params;
  const { 
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
    bot_flow,
    logo_url,
    address,
    bio
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE establishments 
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
                 msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback, bot_flow, logo_url, address, bio`,
      [
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
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Update establishment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// List all establishments (Public - Landing Page)
export const listEstablishments = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, logo_url, address, bio, primary_color, secondary_color, background_color, text_color 
       FROM establishments 
       WHERE is_active = TRUE AND id != '00000000-0000-0000-0000-000000000000'::uuid
       ORDER BY name ASC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('List establishments error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
