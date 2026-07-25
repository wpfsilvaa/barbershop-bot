import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/db';
import { AuthenticatedRequest } from '../middleware/auth';

// List all barbers for an establishment (Admin/Owner/Barber dashboard view)
export const listBarbers = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, email, role, is_active, photo_url, created_at 
       FROM users 
       WHERE establishment_id = $1 AND role IN ('owner', 'admin', 'barber') AND is_active = true
       ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, name ASC`,
      [establishmentId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('List barbers error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// List active barbers publicly (for client Web App booking page)
export const listPublicBarbers = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, photo_url 
       FROM users 
       WHERE establishment_id = $1 AND role = 'barber' AND is_active = true
       ORDER BY name ASC`,
      [establishmentId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('List public barbers error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Create a new barber (Owner/Admin only)
export const createBarber = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId } = req.params;
  const { name, email, password, photo_url } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  try {
    // Check if email already exists
    const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email already in use.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (establishment_id, name, email, password_hash, role, photo_url)
       VALUES ($1, $2, $3, $4, 'barber', $5)
       RETURNING id, name, email, role, is_active, photo_url, created_at`,
      [establishmentId, name, email, passwordHash, photo_url || null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create barber error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Update a barber (Owner/Admin only)
export const updateBarber = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId, barberId } = req.params;
  const { name, email, password, is_active, photo_url } = req.body;

  try {
    // Verify that the barber belongs to this establishment (IDOR mitigation)
    const barberCheck = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = $1 AND establishment_id = $2 AND role = \'barber\'',
      [barberId, establishmentId]
    );

    if (barberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Barber not found in this establishment.' });
    }

    let query = 'UPDATE users SET name = $1, email = $2, is_active = $3, photo_url = $4';
    const queryParams: any[] = [name, email, is_active === undefined ? true : is_active, photo_url || null];

    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      query += ', password_hash = $5 WHERE id = $6 AND establishment_id = $7 RETURNING id, name, email, role, is_active, photo_url';
      queryParams.push(passwordHash, barberId, establishmentId);
    } else {
      query += ' WHERE id = $5 AND establishment_id = $6 RETURNING id, name, email, role, is_active, photo_url';
      queryParams.push(barberId, establishmentId);
    }

    const result = await pool.query(query, queryParams);
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Update barber error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Delete/deactivate barber (Owner/Admin only)
export const deleteBarber = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId, barberId } = req.params;

  try {
    // Verify that the barber belongs to this establishment (IDOR mitigation)
    const barberCheck = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND establishment_id = $2 AND role = \'barber\'',
      [barberId, establishmentId]
    );

    if (barberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Barber not found in this establishment.' });
    }

    // Instead of hard-deleting (which breaks foreign keys for existing appointments), we deactivate or delete.
    // Let's do a hard delete if they have no appointments, or toggle is_active to false if they do.
    const appointmentCheck = await pool.query('SELECT id FROM appointments WHERE barber_id = $1 LIMIT 1', [barberId]);
    
    if (appointmentCheck.rows.length > 0) {
      // Deactivate
      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [barberId]);
      return res.json({ message: 'Barber has past appointments. Deactivated successfully instead of deleting.' });
    } else {
      // Hard delete
      await pool.query('DELETE FROM users WHERE id = $1', [barberId]);
      return res.json({ message: 'Barber deleted successfully.' });
    }
  } catch (error) {
    console.error('Delete barber error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
