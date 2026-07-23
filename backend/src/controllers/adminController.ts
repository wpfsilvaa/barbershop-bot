import { Request, Response } from 'express';
import pool from '../config/db';
import bcrypt from 'bcryptjs';
import { getActiveSessionsList, disconnectWhatsAppSession, startWhatsAppSession, getContainerState } from '../services/whatsappManager';

// 1. List all users across all establishments (Super Admin)
export const listAllUsers = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.phone,
             e.id as establishment_id, e.name as establishment_name
      FROM users u
      LEFT JOIN establishments e ON u.establishment_id = e.id
      ORDER BY u.created_at DESC
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('List all users error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 2. Change password of any user administrative (Super Admin)
export const changeUserPassword = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { password } = req.body;

  if (!password || password.trim().length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, name, email',
      [passwordHash, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({ message: 'User password updated successfully.' });
  } catch (error) {
    console.error('Change user password error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 3. List status of all WhatsApp sessions on server (Super Admin)
export const listWhatsAppSessions = async (req: Request, res: Response) => {
  try {
    // 1. Fetch all establishments
    const establishmentsRes = await pool.query(
      'SELECT id, name, logo_url, commission_percent, is_active, expires_at FROM establishments'
    );
    
    // 2. Fetch all persistent WhatsApp sessions from database
    const sessionsRes = await pool.query(
      'SELECT establishment_id, status, phone FROM whatsapp_sessions'
    );
    
    const sessionsPayload = await Promise.all(establishmentsRes.rows.map(async (est) => {
      const sessionDb = sessionsRes.rows.find(s => s.establishment_id === est.id);
      
      // Map standard status values to frontend expected strings ('CONNECTED' or 'DISCONNECTED')
      let status = 'DISCONNECTED';
      if (sessionDb && sessionDb.status === 'connected') {
        status = 'CONNECTED';
      }

      // Check if container is running
      const containerName = `barberhub-whatsapp-${est.id}`;
      const dockerState = await getContainerState(containerName);
      
      return {
        establishment_id: est.id,
        establishment_name: est.name,
        logo_url: est.logo_url,
        commission_percent: est.commission_percent,
        is_active: est.is_active,
        expires_at: est.expires_at,
        status: status,
        phone: sessionDb ? sessionDb.phone : null,
        container_running: dockerState.running
      };
    }));

    return res.json(sessionsPayload);
  } catch (error) {
    console.error('List whatsapp sessions error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 4. Remotely logout / disconnect WhatsApp session of any establishment (Super Admin)
export const logoutWhatsAppSession = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;
  try {
    await disconnectWhatsAppSession(String(establishmentId));
    return res.json({ message: 'WhatsApp session disconnected and logged out successfully.' });
  } catch (error) {
    console.error('Logout whatsapp session error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 5. Calculate establishment metrics (faturamento, barbeiro, serviços, etc.)
export const getEstablishmentMetrics = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;
  const { days } = req.query; 
  const periodDays = parseInt(days as string, 10) || 30;

  try {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - periodDays);
    const dateLimitStr = dateLimit.toISOString().split('T')[0];

    // Get establishment commission_percent
    const estRes = await pool.query('SELECT commission_percent FROM establishments WHERE id = $1', [establishmentId]);
    const commissionPercent = estRes.rows.length > 0 && estRes.rows[0].commission_percent !== null ? estRes.rows[0].commission_percent : 0;

    // 1. General totals
    const totalsRes = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as total_revenue,
         COALESCE(SUM(CASE WHEN a.status = 'confirmed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as pending_revenue,
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as total_bookings,
         COALESCE(AVG(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) END), 0) as avg_ticket
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE a.establishment_id = $1 
         AND a.appointment_time >= $2 
         AND a.status IN ('confirmed', 'completed')`,
      [establishmentId, dateLimitStr]
    );

    // 2. Bookings by status
    const statusRes = await pool.query(
      `SELECT status, COUNT(id) as count
       FROM appointments
       WHERE establishment_id = $1 AND appointment_time >= $2
       GROUP BY status`,
      [establishmentId, dateLimitStr]
    );

    // 3. Performance by Barber
    const barberPerformanceRes = await pool.query(
      `SELECT 
         u.id as barber_id, 
         u.name as barber_name, 
         u.photo_url,
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as total_bookings,
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as total_revenue,
         COALESCE(SUM(CASE WHEN a.status = 'confirmed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as pending_revenue
       FROM users u
       LEFT JOIN appointments a ON u.id = a.barber_id AND a.status IN ('confirmed', 'completed') AND a.appointment_time >= $2
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE u.establishment_id = $1 AND u.role = 'barber' AND u.is_active = true
       GROUP BY u.id, u.name, u.photo_url
       ORDER BY total_revenue DESC`,
      [establishmentId, dateLimitStr]
    );

    // 4. Distribution of Services (top selling concluídos)
    const servicesDistributionRes = await pool.query(
      `SELECT 
         s.id as service_id, 
         s.name as service_name, 
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as count,
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as revenue
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE a.establishment_id = $1 
         AND a.appointment_time >= $2 
         AND a.status IN ('confirmed', 'completed')
       GROUP BY s.id, s.name
       ORDER BY count DESC`,
      [establishmentId, dateLimitStr]
    );

    // 5. Daily bookings evolution (concluídos)
    const evolutionRes = await pool.query(
      `SELECT 
         DATE(a.appointment_time) as date_str,
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as count,
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as revenue
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE a.establishment_id = $1 
         AND a.appointment_time >= $2 
         AND a.status IN ('confirmed', 'completed')
       GROUP BY DATE(a.appointment_time)
       ORDER BY date_str ASC`,
      [establishmentId, dateLimitStr]
    );

    return res.json({
      total_revenue: parseFloat(totalsRes.rows[0].total_revenue),
      pending_revenue: parseFloat(totalsRes.rows[0].pending_revenue),
      total_bookings: parseInt(totalsRes.rows[0].total_bookings, 10),
      avg_ticket: parseFloat(totalsRes.rows[0].avg_ticket),
      commission_percent: commissionPercent,
      status_distribution: statusRes.rows,
      barber_performance: barberPerformanceRes.rows.map(r => ({
        ...r,
        total_bookings: parseInt(r.total_bookings, 10),
        total_revenue: parseFloat(r.total_revenue),
        pending_revenue: parseFloat(r.pending_revenue)
      })),
      services_distribution: servicesDistributionRes.rows.map(r => ({
        ...r,
        count: parseInt(r.count, 10),
        revenue: parseFloat(r.revenue)
      })),
      evolution: evolutionRes.rows.map(r => ({
        ...r,
        count: parseInt(r.count, 10),
        revenue: parseFloat(r.revenue)
      }))
    });
  } catch (error) {
    console.error('Get establishment metrics error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 6. Calculate global metrics across all establishments (Super Admin Only)
export const getGlobalMetrics = async (req: Request, res: Response) => {
  const { days } = req.query; 
  const periodDays = parseInt(days as string, 10) || 30;

  try {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - periodDays);
    const dateLimitStr = dateLimit.toISOString().split('T')[0];

    // 1. General totals
    const totalsRes = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as total_revenue,
         COALESCE(SUM(CASE WHEN a.status = 'confirmed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as pending_revenue,
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as total_bookings,
         COALESCE(AVG(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) END), 0) as avg_ticket
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE a.appointment_time >= $1 
         AND a.status IN ('confirmed', 'completed')`,
      [dateLimitStr]
    );

    // 2. Performance by Establishment
    const establishmentPerformanceRes = await pool.query(
      `SELECT 
         e.id as establishment_id, 
         e.name as establishment_name, 
         e.logo_url,
         e.commission_percent,
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as total_bookings,
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as total_revenue,
         COALESCE(SUM(CASE WHEN a.status = 'confirmed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as pending_revenue
       FROM establishments e
       LEFT JOIN appointments a ON e.id = a.establishment_id AND a.status IN ('confirmed', 'completed') AND a.appointment_time >= $1
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       GROUP BY e.id, e.name, e.logo_url, e.commission_percent
       ORDER BY total_revenue DESC`,
      [dateLimitStr]
    );

    // 3. Distribution of Services (top selling concluídos)
    const servicesDistributionRes = await pool.query(
      `SELECT 
         s.id as service_id, 
         s.name as service_name, 
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as count,
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as revenue
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE a.appointment_time >= $1 
         AND a.status IN ('confirmed', 'completed')
       GROUP BY s.id, s.name
       ORDER BY count DESC
       LIMIT 5`,
      [dateLimitStr]
    );

    // 4. Daily bookings evolution (concluídos)
    const evolutionRes = await pool.query(
      `SELECT 
         DATE(a.appointment_time) as date_str,
         COUNT(CASE WHEN a.status = 'completed' THEN a.id END) as count,
         COALESCE(SUM(CASE WHEN a.status = 'completed' THEN COALESCE(bs.price, s.price) ELSE 0 END), 0) as revenue
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE a.appointment_time >= $1 
         AND a.status IN ('confirmed', 'completed')
       GROUP BY DATE(a.appointment_time)
       ORDER BY date_str ASC`,
      [dateLimitStr]
    );

    return res.json({
      total_revenue: parseFloat(totalsRes.rows[0].total_revenue),
      pending_revenue: parseFloat(totalsRes.rows[0].pending_revenue),
      total_bookings: parseInt(totalsRes.rows[0].total_bookings, 10),
      avg_ticket: parseFloat(totalsRes.rows[0].avg_ticket),
      establishment_performance: establishmentPerformanceRes.rows.map(r => ({
        ...r,
        total_bookings: parseInt(r.total_bookings, 10),
        total_revenue: parseFloat(r.total_revenue),
        pending_revenue: parseFloat(r.pending_revenue),
        commission_percent: r.commission_percent !== null && r.commission_percent !== undefined ? parseInt(r.commission_percent, 10) : 0
      })),
      services_distribution: servicesDistributionRes.rows.map(r => ({
        ...r,
        count: parseInt(r.count, 10),
        revenue: parseFloat(r.revenue)
      })),
      evolution: evolutionRes.rows.map(r => ({
        ...r,
        count: parseInt(r.count, 10),
        revenue: parseFloat(r.revenue)
      }))
    });
  } catch (error) {
    console.error('Get global metrics error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 7. Update establishment commission percent (Super Admin Only)
export const updateEstablishmentCommission = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;
  const { commission_percent } = req.body;

  const parsedPercent = parseInt(commission_percent, 10);
  if (isNaN(parsedPercent) || parsedPercent < 0 || parsedPercent > 100) {
    return res.status(400).json({ error: 'Commission percentage must be a valid number between 0 and 100.' });
  }

  try {
    const result = await pool.query(
      'UPDATE establishments SET commission_percent = $1 WHERE id = $2 RETURNING id, name, commission_percent',
      [parsedPercent, establishmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    return res.json({ 
      message: 'Commission percentage updated successfully.',
      establishment: result.rows[0]
    });
  } catch (error) {
    console.error('Update establishment commission error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 8. Update establishment status (is_active) (Super Admin Only)
export const updateEstablishmentStatus = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;
  const { is_active } = req.body;

  if (is_active === undefined) {
    return res.status(400).json({ error: 'Status is_active is required.' });
  }

  try {
    const result = await pool.query(
      'UPDATE establishments SET is_active = $1 WHERE id = $2 RETURNING id, name, is_active',
      [is_active, establishmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    return res.json({ 
      message: 'Establishment status updated successfully.',
      establishment: result.rows[0]
    });
  } catch (error) {
    console.error('Update establishment status error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 9. Update establishment license expiration date (Super Admin Only)
export const updateEstablishmentLicense = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;
  const { expires_at, add_days } = req.body;

  try {
    let finalExpiresAt: Date;

    if (add_days !== undefined) {
      const parsedDays = parseInt(add_days, 10);
      if (isNaN(parsedDays)) {
        return res.status(400).json({ error: 'Days to add must be a valid number.' });
      }

      // Buscar expiração atual
      const estRes = await pool.query('SELECT expires_at FROM establishments WHERE id = $1', [establishmentId]);
      if (estRes.rows.length === 0) {
        return res.status(404).json({ error: 'Establishment not found.' });
      }

      // Se já estiver expirado, adiciona a partir de NOW(), caso contrário a partir da expiração atual!
      const currentExpiresAt = estRes.rows[0].expires_at ? new Date(estRes.rows[0].expires_at) : new Date();
      const baseDate = currentExpiresAt < new Date() ? new Date() : currentExpiresAt;
      
      finalExpiresAt = new Date(baseDate.getTime() + parsedDays * 24 * 60 * 60 * 1000);
    } else if (expires_at !== undefined) {
      finalExpiresAt = new Date(expires_at);
      if (isNaN(finalExpiresAt.getTime())) {
        return res.status(400).json({ error: 'Invalid expiration date.' });
      }
    } else {
      return res.status(400).json({ error: 'Either expires_at or add_days must be provided.' });
    }

    const result = await pool.query(
      'UPDATE establishments SET expires_at = $1 WHERE id = $2 RETURNING id, name, expires_at',
      [finalExpiresAt, establishmentId]
    );

    return res.json({
      message: 'License expiration updated successfully.',
      establishment: result.rows[0]
    });
  } catch (error) {
    console.error('Update establishment license error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 10. Delete establishment and all its cascade children (Super Admin Only)
export const deleteEstablishment = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;

  if (establishmentId === '00000000-0000-0000-0000-000000000000') {
    return res.status(400).json({ error: 'Cannot delete the system admin establishment.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Verify existence
    const estRes = await client.query('SELECT id, name FROM establishments WHERE id = $1', [establishmentId]);
    if (estRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    const estName = estRes.rows[0].name;

    // 2. Disconnect WhatsApp session from memory if connected
    try {
      await disconnectWhatsAppSession(String(establishmentId));
    } catch (err) {
      console.log('No active whatsapp session to disconnect from memory.');
    }

    // 3. Delete from DB (foreign key constraints with ON DELETE CASCADE will handle all children)
    await client.query('DELETE FROM establishments WHERE id = $1', [establishmentId]);

    await client.query('COMMIT');
    return res.json({ message: `Barbearia "${estName}" e todos os seus barbeiros e dados vinculados foram excluídos com sucesso.` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete establishment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
};

export const startWhatsAppSessionAdmin = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;
  try {
    const estRes = await pool.query('SELECT id FROM establishments WHERE id = $1', [establishmentId]);
    if (estRes.rows.length === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    await startWhatsAppSession(String(establishmentId));
    return res.json({ message: 'WhatsApp bot container initialized successfully.' });
  } catch (error: any) {
    console.error('Start whatsapp session admin error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error.' });
  }
};
