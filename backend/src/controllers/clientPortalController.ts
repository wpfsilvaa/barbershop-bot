import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { sendOrchestratedMessage } from '../services/whatsappManager';
import { generateFutureBookingsForPlan } from './planController';

const JWT_SECRET = process.env.JWT_SECRET || 'super-barber-secret-key-change-it';

// Helper to format phone numbers
const formatPhone = (phone: string) => {
  let clean = phone.replace(/\D/g, '').trim();
  if (clean.startsWith('55')) {
    clean = clean.substring(2);
  }
  if (clean.length === 11 && clean[2] === '9') {
    clean = clean.substring(0, 2) + clean.substring(3);
  }
  return '55' + clean;
};

// 1. Client Authentication & Registry (Reverted back to no-OTP simple access)
export const authClient = async (req: Request, res: Response) => {
  const { phone, name } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const cleanPhone = formatPhone(phone);

  try {
    // Check if client exists
    const clientRes = await pool.query(
      'SELECT id, name, phone FROM clients WHERE phone = $1',
      [cleanPhone]
    );

    if (clientRes.rows.length > 0) {
      const client = clientRes.rows[0];
      
      // If client exists, generate token
      const token = jwt.sign(
        { id: client.id, phone: client.phone, name: client.name, role: 'client' },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      return res.json({ token, client });
    }

    // Client does not exist. If name is not provided, request registry
    if (!name) {
      return res.json({ exists: false, message: 'Client not registered yet.' });
    }

    // Create client
    const newClient = await pool.query(
      'INSERT INTO clients (name, phone) VALUES ($1, $2) RETURNING id, name, phone',
      [name.trim(), cleanPhone]
    );

    const client = newClient.rows[0];
    const token = jwt.sign(
      { id: client.id, phone: client.phone, name: client.name, role: 'client' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({ token, client });
  } catch (error) {
    console.error('Client auth error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 2. Fetch Client Info and Dashboard Data
export const getClientData = async (req: any, res: Response) => {
  const clientId = req.user.id;

  try {
    // 1. Fetch bookings
    const bookingsRes = await pool.query(
      `SELECT a.id, a.appointment_time, a.status, a.cancellation_reason,
              s.name as service_name, s.price, s.duration_minutes,
              u.name as barber_name,
              e.name as establishment_name, e.id as establishment_id,
              f.rating, f.comment
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       JOIN users u ON a.barber_id = u.id
       JOIN establishments e ON a.establishment_id = e.id
       LEFT JOIN feedbacks f ON f.appointment_id = a.id
       WHERE a.client_id = $1
       ORDER BY a.appointment_time DESC`,
      [clientId]
    );

    // 2. Fetch active plans
    const plansRes = await pool.query(
      `SELECT cp.id, cp.plan_type, cp.preferred_time, cp.preferred_day_of_week, cp.is_active, cp.created_at,
              b.name as barber_name,
              e.name as establishment_name
       FROM client_plans cp
       JOIN users b ON cp.barber_id = b.id
       JOIN establishments e ON cp.establishment_id = e.id
       WHERE cp.client_id = $1 AND cp.is_active = true
       ORDER BY cp.created_at DESC`,
      [clientId]
    );

    // 3. Fetch all establishments (to allow booking)
    const estRes = await pool.query(
      `SELECT id, name, logo_url, opening_time, closing_time FROM establishments ORDER BY name ASC`
    );

    return res.json({
      bookings: bookingsRes.rows,
      plans: plansRes.rows,
      establishments: estRes.rows
    });
  } catch (error) {
    console.error('Get client data error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 3. Fetch specific establishment details (barbers, services, plans) for portal booking
export const getEstablishmentDetails = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;

  try {
    // Barbers
    const barbersRes = await pool.query(
      `SELECT id, name, photo_url FROM users WHERE establishment_id = $1 AND role = 'barber' AND is_active = true ORDER BY name ASC`,
      [establishmentId]
    );

    // Services
    const servicesRes = await pool.query(
      `SELECT id, name, price, duration_minutes, description FROM services WHERE establishment_id = $1 ORDER BY name ASC`,
      [establishmentId]
    );

    // Available plans (static in the database schema)
    const plans = [
      { id: 'quinzenal', name: 'Plano Quinzenal', price: '79.90', duration_days: 30, max_bookings: 2, description: 'Cortes quinzenais programados em um dia e horário fixos na semana.' },
      { id: 'mensal', name: 'Plano Mensal', price: '149.90', duration_days: 30, max_bookings: 4, description: 'Cortes semanais programados em um dia e horário fixos na semana.' }
    ];

    return res.json({
      barbers: barbersRes.rows,
      services: servicesRes.rows,
      plans: plans
    });
  } catch (error) {
    console.error('Get est details error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 4. Booking rescheduling
export const rescheduleBooking = async (req: any, res: Response) => {
  const clientId = req.user.id;
  const { bookingId } = req.params;
  const { newTime } = req.body; // ISO String

  if (!newTime) {
    return res.status(400).json({ error: 'New appointment time is required.' });
  }

  const targetDate = new Date(newTime);
  const now = new Date();
  
  if (targetDate.getTime() <= now.getTime()) {
    return res.status(400).json({ error: 'New appointment date must be in the future.' });
  }

  try {
    // 1. Fetch current appointment details and verify ownership
    const apptCheck = await pool.query(
      `SELECT a.id, a.appointment_time, a.status, a.barber_id, a.establishment_id,
              s.duration_minutes, c.name as client_name, b.name as barber_name
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       JOIN clients c ON a.client_id = c.id
       JOIN users b ON a.barber_id = b.id
       WHERE a.id = $1 AND a.client_id = $2`,
      [bookingId, clientId]
    );

    if (apptCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found or unauthorized.' });
    }

    const appt = apptCheck.rows[0];

    // 2. Check 2 hours limit on previous time
    const prevTime = new Date(appt.appointment_time);
    const diffPrev = (prevTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (diffPrev < 2) {
      return res.status(400).json({ error: 'Cannot reschedule appointments with less than 2 hours of anticipation.' });
    }

    const duration = appt.duration_minutes;
    const endTime = new Date(targetDate.getTime() + duration * 60 * 1000);

    // 3. Collision check
    const collisionRes = await pool.query(
      `SELECT id FROM appointments 
       WHERE id != $1 AND barber_id = $2 AND status != 'cancelled'
         AND (($3 >= appointment_time AND $3 < appointment_time + (SELECT duration_minutes FROM services WHERE id = service_id) * interval '1 minute')
           OR ($4 > appointment_time AND $4 <= appointment_time + (SELECT duration_minutes FROM services WHERE id = service_id) * interval '1 minute')
           OR ($3 <= appointment_time AND $4 >= appointment_time + (SELECT duration_minutes FROM services WHERE id = service_id) * interval '1 minute'))`,
      [bookingId, appt.barber_id, targetDate.toISOString(), endTime.toISOString()]
    );

    if (collisionRes.rows.length > 0) {
      return res.status(400).json({ error: 'The selected barber has a schedule collision at this time.' });
    }

    // 4. Update appointment
    await pool.query(
      `UPDATE appointments SET appointment_time = $1, status = 'confirmed', cancellation_reason = NULL WHERE id = $2`,
      [targetDate.toISOString(), bookingId]
    );

    // 5. Notify via WhatsApp
    try {
      const dateStr = targetDate.toLocaleDateString('pt-BR');
      const timeStr = targetDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const msgText = `🔄 *Agendamento Alterado*\n\nOlá, *${appt.client_name}*!\n\nSeu horário com o profissional *${appt.barber_name}* foi remarcado para o dia *${dateStr}* às *${timeStr}* com sucesso!`;
      await sendOrchestratedMessage(String(appt.establishment_id), req.user.phone, msgText);
    } catch (e) {
      console.error('WhatsApp notify rescheduling error:', e);
    }

    return res.json({ message: 'Appointment rescheduled successfully.' });
  } catch (error) {
    console.error('Reschedule booking error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 5. Cancel individual appointment
export const cancelClientBooking = async (req: any, res: Response) => {
  const clientId = req.user.id;
  const { bookingId } = req.params;

  try {
    const apptCheck = await pool.query(
      `SELECT a.id, a.appointment_time, a.status, a.establishment_id,
              c.name as client_name, b.name as barber_name
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       JOIN users b ON a.barber_id = b.id
       WHERE a.id = $1 AND a.client_id = $2`,
      [bookingId, clientId]
    );

    if (apptCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found or unauthorized.' });
    }

    const appt = apptCheck.rows[0];

    const apptTime = new Date(appt.appointment_time);
    const now = new Date();
    const diff = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (diff < 2) {
      return res.status(400).json({ error: 'Cannot cancel appointments with less than 2 hours of anticipation.' });
    }

    await pool.query(
      `UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Cancelado pelo cliente via Portal' WHERE id = $1`,
      [bookingId]
    );

    // Notify
    try {
      const dateStr = apptTime.toLocaleDateString('pt-BR');
      const timeStr = apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const msgText = `❌ *Agendamento Cancelado*\n\nOlá, *${appt.client_name}*!\n\nSeu agendamento para o dia *${dateStr}* às *${timeStr}* com *${appt.barber_name}* foi cancelado com sucesso.`;
      await sendOrchestratedMessage(String(appt.establishment_id), req.user.phone, msgText);
    } catch (e) {
      console.error('WhatsApp notify cancel error:', e);
    }

    return res.json({ message: 'Appointment cancelled successfully.' });
  } catch (error) {
    console.error('Cancel booking error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 6. Cancel all future appointments
export const cancelAllClientBookings = async (req: any, res: Response) => {
  const clientId = req.user.id;

  try {
    const apptsRes = await pool.query(
      `SELECT a.id, a.appointment_time, a.establishment_id 
       FROM appointments a
       WHERE a.client_id = $1 AND a.appointment_time > NOW() AND a.status = 'confirmed'`,
      [clientId]
    );

    if (apptsRes.rows.length === 0) {
      return res.status(400).json({ error: 'No future confirmed appointments found.' });
    }

    const now = new Date();
    let cancelledCount = 0;
    let errorCount = 0;

    for (const appt of apptsRes.rows) {
      const apptTime = new Date(appt.appointment_time);
      const diff = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (diff < 2) {
        errorCount++;
      } else {
        await pool.query(
          `UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Cancelado em lote via Portal' WHERE id = $1`,
          [appt.id]
        );
        cancelledCount++;
      }
    }

    if (cancelledCount > 0) {
      try {
        const msgText = `❌ *Agendamentos Cancelados*\n\nOlá, *${req.user.name}*!\n\nVocê cancelou *${cancelledCount} agendamentos futuros* de uma vez pelo nosso Portal de Clientes.`;
        await sendOrchestratedMessage(String(apptsRes.rows[0].establishment_id), req.user.phone, msgText);
      } catch (e) {
        console.error('WhatsApp batch cancel notify error:', e);
      }
    }

    return res.json({
      message: 'Batch cancellation finished.',
      cancelledCount,
      errorCount
    });
  } catch (error) {
    console.error('Cancel all bookings error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 7. Submit Feedback / Rating for completed service
export const createFeedback = async (req: any, res: Response) => {
  const clientId = req.user.id;
  const { appointmentId, rating, comment } = req.body;

  const parsedRating = parseInt(rating, 10);
  if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
  }

  try {
    // Verify booking is completed and belongs to client
    const apptCheck = await pool.query(
      `SELECT id, establishment_id FROM appointments WHERE id = $1 AND client_id = $2 AND status = 'completed'`,
      [appointmentId, clientId]
    );

    if (apptCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Feedback can only be submitted for completed and paid appointments.' });
    }

    // Check if feedback already exists
    const feedCheck = await pool.query(
      'SELECT id FROM feedbacks WHERE appointment_id = $1',
      [appointmentId]
    );

    if (feedCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Feedback already submitted for this appointment.' });
    }

    const estId = apptCheck.rows[0].establishment_id;

    // Insert feedback
    await pool.query(
      `INSERT INTO feedbacks (appointment_id, client_id, establishment_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [appointmentId, clientId, estId, parsedRating, comment ? comment.trim() : null]
    );

    return res.json({ message: 'Feedback submitted successfully. Thank you!' });
  } catch (error) {
    console.error('Create feedback error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 8. Book new appointment from portal
export const clientBookAppointment = async (req: any, res: Response) => {
  const clientId = req.user.id;
  const { establishmentId, barberId, serviceId, appointmentTime } = req.body;

  if (!establishmentId || !barberId || !serviceId || !appointmentTime) {
    return res.status(400).json({ error: 'Missing required parameters.' });
  }

  const targetDate = new Date(appointmentTime);
  const now = new Date();

  if (targetDate.getTime() <= now.getTime()) {
    return res.status(400).json({ error: 'Appointment date must be in the future.' });
  }

  try {
    // Service duration
    const serviceRes = await pool.query(
      'SELECT name, price, duration_minutes FROM services WHERE id = $1 AND establishment_id = $2',
      [serviceId, establishmentId]
    );

    if (serviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    const service = serviceRes.rows[0];
    const duration = service.duration_minutes;
    const endTime = new Date(targetDate.getTime() + duration * 60 * 1000);

    // Collision check
    const collisionRes = await pool.query(
      `SELECT id FROM appointments 
       WHERE barber_id = $1 AND status != 'cancelled'
         AND (($2 >= appointment_time AND $2 < appointment_time + (SELECT duration_minutes FROM services WHERE id = service_id) * interval '1 minute')
           OR ($3 > appointment_time AND $3 <= appointment_time + (SELECT duration_minutes FROM services WHERE id = service_id) * interval '1 minute')
           OR ($2 <= appointment_time AND $3 >= appointment_time + (SELECT duration_minutes FROM services WHERE id = service_id) * interval '1 minute'))`,
      [barberId, targetDate.toISOString(), endTime.toISOString()]
    );

    if (collisionRes.rows.length > 0) {
      return res.status(400).json({ error: 'This time slot is no longer available.' });
    }

    // Insert booking
    const result = await pool.query(
      `INSERT INTO appointments (establishment_id, barber_id, client_id, service_id, appointment_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')
       RETURNING id`,
      [establishmentId, barberId, clientId, serviceId, targetDate.toISOString()]
    );

    // Fetch names for WhatsApp
    const namesRes = await pool.query(
      `SELECT b.name as barber_name, e.name as establishment_name
       FROM users b
       JOIN establishments e ON b.establishment_id = e.id
       WHERE b.id = $1`,
      [barberId]
    );
    const details = namesRes.rows[0];

    // Notify
    try {
      const dateStr = targetDate.toLocaleDateString('pt-BR');
      const timeStr = targetDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const msgText = `📅 *Novo Agendamento Realizado*\n\nOlá, *${req.user.name}*!\n\nVocê agendou o serviço *${service.name}* na *${details.establishment_name}*:\n\n*Profissional:* ${details.barber_name}\n*Data:* ${dateStr}\n*Horário:* ${timeStr}\n*Valor:* R$ ${parseFloat(service.price).toFixed(2)}\n\nEsperamos você!`;
      await sendOrchestratedMessage(String(establishmentId), req.user.phone, msgText);
    } catch (e) {
      console.error('WhatsApp notify booking error:', e);
    }

    return res.json({
      message: 'Appointment booked successfully.',
      bookingId: result.rows[0].id
    });
  } catch (error) {
    console.error('Portal booking error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// 9. Subscribe to a recurring plan
export const subscribeToPlan = async (req: any, res: Response) => {
  const clientId = req.user.id;
  const { establishmentId, barberId, planType, preferredTime, preferredDayOfWeek } = req.body;

  if (!establishmentId || !barberId || !planType || !preferredTime || preferredDayOfWeek === undefined) {
    return res.status(400).json({ error: 'All fields (establishmentId, barberId, planType, preferredTime, preferredDayOfWeek) are required.' });
  }

  if (planType !== 'quinzenal' && planType !== 'mensal') {
    return res.status(400).json({ error: 'Invalid plan type.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check if barber belongs to this establishment
    const barberCheck = await client.query(
      "SELECT id FROM users WHERE id = $1 AND establishment_id = $2 AND role = 'barber'",
      [barberId, establishmentId]
    );

    if (barberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid barber for this establishment.' });
    }

    // 2. Insert or update the plan (UPSERT)
    const planResult = await client.query(
      `INSERT INTO client_plans (establishment_id, client_id, barber_id, plan_type, preferred_time, preferred_day_of_week, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (client_id, establishment_id) 
       DO UPDATE SET barber_id = EXCLUDED.barber_id,
                     plan_type = EXCLUDED.plan_type,
                     preferred_time = EXCLUDED.preferred_time,
                     preferred_day_of_week = EXCLUDED.preferred_day_of_week,
                     is_active = EXCLUDED.is_active
       RETURNING id, plan_type, preferred_time, preferred_day_of_week, is_active`,
      [establishmentId, clientId, barberId, planType, preferredTime, preferredDayOfWeek]
    );

    // 3. Run instant recurrence scheduler generator for the next 4 weeks
    await generateFutureBookingsForPlan(client, String(establishmentId), clientId, barberId, planType, preferredTime, preferredDayOfWeek);

    // Get establishment name
    const estNameRes = await client.query('SELECT name FROM establishments WHERE id = $1', [establishmentId]);
    const estName = estNameRes.rows[0]?.name || 'Barbearia';

    await client.query('COMMIT');

    // Notify via WhatsApp
    try {
      const planName = planType === 'mensal' ? 'Plano Mensal' : 'Plano Quinzenal';
      const msgText = `💳 *Assinatura Realizada!*\n\nOlá, *${req.user.name}*!\n\nSua assinatura do *${planName}* na *${estName}* foi confirmada! 🎉\n\nSeus próximos horários já foram reservados automaticamente.`;
      await sendOrchestratedMessage(String(establishmentId), req.user.phone, msgText);
    } catch (e) {
      console.error('WhatsApp notify subscription error:', e);
    }

    return res.json({ message: 'Subscribed to plan successfully.', plan: planResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Subscribe to plan error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
};
