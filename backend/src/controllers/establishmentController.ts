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
              bot_flow, logo_url, address, bio, photos, bot_active,
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
              bot_flow, logo_url, address, bio, photos, is_active, bot_active
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
    bio,
    photos,
    bot_active
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE establishments 
       SET name = COALESCE($1, name), 
           primary_color = COALESCE($2, primary_color), 
           secondary_color = COALESCE($3, secondary_color), 
           background_color = COALESCE($4, background_color), 
           text_color = COALESCE($5, text_color), 
           opening_time = COALESCE($6, opening_time), 
           closing_time = COALESCE($7, closing_time), 
           slot_duration_minutes = COALESCE($8, slot_duration_minutes),
           msg_welcome = COALESCE($9, msg_welcome),
           msg_select_barber = COALESCE($10, msg_select_barber),
           msg_select_date = COALESCE($11, msg_select_date),
           msg_select_slot = COALESCE($12, msg_select_slot),
           msg_confirmed = COALESCE($13, msg_confirmed),
           msg_fallback = COALESCE($14, msg_fallback),
           bot_flow = COALESCE($15::jsonb, bot_flow),
           logo_url = COALESCE($16, logo_url),
           address = COALESCE($17, address),
           bio = COALESCE($18, bio),
           photos = COALESCE($19, photos),
           bot_active = COALESCE($20, bot_active)
       WHERE id = $21
       RETURNING id, name, slug, primary_color, secondary_color, background_color, text_color, 
                 opening_time, closing_time, slot_duration_minutes,
                 msg_welcome, msg_select_barber, msg_select_date, msg_select_slot, msg_confirmed, msg_fallback, bot_flow, logo_url, address, bio, photos, bot_active`,
      [
        name === undefined || name === '' ? null : name, 
        primary_color === undefined || primary_color === '' ? null : primary_color, 
        secondary_color === undefined || secondary_color === '' ? null : secondary_color, 
        background_color === undefined || background_color === '' ? null : background_color, 
        text_color === undefined || text_color === '' ? null : text_color, 
        opening_time === undefined || opening_time === '' ? null : opening_time, 
        closing_time === undefined || closing_time === '' ? null : closing_time, 
        slot_duration_minutes === undefined || slot_duration_minutes === null ? null : slot_duration_minutes,
        msg_welcome === undefined ? null : msg_welcome,
        msg_select_barber === undefined ? null : msg_select_barber,
        msg_select_date === undefined ? null : msg_select_date,
        msg_select_slot === undefined ? null : msg_select_slot,
        msg_confirmed === undefined ? null : msg_confirmed,
        msg_fallback === undefined ? null : msg_fallback,
        bot_flow ? JSON.stringify(bot_flow) : null,
        logo_url === undefined ? null : logo_url,
        address === undefined ? null : address,
        bio === undefined ? null : bio,
        photos === undefined || !photos ? null : photos,
        bot_active === undefined || bot_active === null ? null : bot_active,
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
