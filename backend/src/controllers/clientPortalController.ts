import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { sendOrchestratedMessage } from '../services/whatsappManager';
import { broadcastToEstablishment } from '../services/wsServer';
import { generateFutureBookingsForPlan } from './planController';
import { JWT_SECRET, JWT_CLIENT_EXPIRATION } from '../config/jwt';
import { normalizePhone } from '../utils/phone';
import { formatZoned } from '../utils/datetime';

// 1. Client Authentication & Registry (Reverted back to no-OTP simple access)
//
// ATENÇÃO (aceito conscientemente pelo produto): este endpoint emite um token de
// 30 dias apenas com o número de telefone, sem prova de posse da linha. Quem
// souber o telefone de um cliente acessa histórico, remarca e cancela os
// agendamentos dele. A mitigação definitiva é enviar um código de 6 dígitos por
// WhatsApp (as colunas `auth_code`/`auth_code_expires_at` já existem no schema).
// Enquanto isso não volta, a rota está sob rate limit dedicado em routes.ts.
export const authClient = async (req: Request, res: Response) => {
  const { phone, name } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const cleanPhone = normalizePhone(phone);

  if (cleanPhone.length < 12) {
    return res.status(400).json({ error: 'Telefone inválido. Informe DDD + número.' });
  }

  try {
    // Um mesmo telefone pode ter vários registros (um por barbearia + o global do
    // portal). Sem ORDER BY, o Postgres devolvia uma linha arbitrária e o cliente
    // logava ora em um cadastro, ora em outro — perdendo o histórico. Fixamos a
    // preferência: o registro global do portal (establishment_id IS NULL) e, na
    // falta dele, o mais antigo.
    const clientRes = await pool.query(
      `SELECT id, name, phone FROM clients
       WHERE phone = $1
       ORDER BY (establishment_id IS NULL) DESC, created_at ASC
       LIMIT 1`,
      [cleanPhone]
    );

    if (clientRes.rows.length > 0) {
      const client = clientRes.rows[0];

      // If client exists, generate token
      const token = jwt.sign(
        { id: client.id, phone: client.phone, name: client.name, role: 'client' },
        JWT_SECRET,
        { expiresIn: JWT_CLIENT_EXPIRATION }
      );

      return res.json({ token, client });
    }

    // Client does not exist. If name is not provided, request registry
    if (!name || String(name).trim().length < 2) {
      return res.json({ exists: false, message: 'Client not registered yet.' });
    }

    // Create client
    const newClient = await pool.query(
      'INSERT INTO clients (name, phone) VALUES ($1, $2) RETURNING id, name, phone',
      [String(name).trim().slice(0, 255), cleanPhone]
    );

    const client = newClient.rows[0];
    const token = jwt.sign(
      { id: client.id, phone: client.phone, name: client.name, role: 'client' },
      JWT_SECRET,
      { expiresIn: JWT_CLIENT_EXPIRATION }
    );

    return res.json({ token, client });
  } catch (error) {
    console.error('Client auth error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Um mesmo cliente tem um registro por barbearia (`clients` é multi-tenant), todos
 * amarrados ao mesmo telefone. O painel listava agendamentos de TODOS esses
 * registros, mas cancelar/remarcar só considerava `req.user.id` — o cliente via o
 * agendamento e recebia "not found or unauthorized" ao tentar mexer nele.
 *
 * Esta função devolve o conjunto de IDs que pertencem ao telefone do token (que é
 * assinado pelo servidor), preservando o isolamento entre clientes distintos.
 */
async function getOwnedClientIds(req: any): Promise<string[]> {
  const phone = normalizePhone(req.user?.phone);
  const selfId = req.user?.id;

  if (!phone) return selfId ? [selfId] : [];

  const rows = await pool.query('SELECT id FROM clients WHERE phone = $1', [phone]);
  const ids = rows.rows.map((r) => r.id);

  // Garante que o próprio id do token esteja presente mesmo se o telefone tiver
  // sido alterado no cadastro depois da emissão.
  if (selfId && !ids.includes(selfId)) ids.push(selfId);

  return ids;
}

// 2. Fetch Client Info and Dashboard Data
export const getClientData = async (req: any, res: Response) => {
  try {
    // Fetch all client IDs associated with this phone number to aggregate bookings
    const clientIds = await getOwnedClientIds(req);

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
       WHERE a.client_id = ANY($1)
       ORDER BY a.appointment_time DESC`,
      [clientIds]
    );

    // 2. Fetch active plans
    const plansRes = await pool.query(
      `SELECT cp.id, cp.plan_type, cp.preferred_time, cp.preferred_day_of_week, cp.is_active, cp.created_at,
              b.name as barber_name,
              e.name as establishment_name
       FROM client_plans cp
       JOIN users b ON cp.barber_id = b.id
       JOIN establishments e ON cp.establishment_id = e.id
       WHERE cp.client_id = ANY($1) AND cp.is_active = true
       ORDER BY cp.created_at DESC`,
      [clientIds]
    );

    // 3. Fetch all establishments (to allow booking)
    const estRes = await pool.query(
      `SELECT id, name, logo_url, address, opening_time, closing_time 
       FROM establishments 
       WHERE is_active = TRUE AND id != '00000000-0000-0000-0000-000000000000'::uuid 
       ORDER BY name ASC`
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
  const { bookingId } = req.params;
  const { newTime } = req.body; // ISO String

  if (!newTime) {
    return res.status(400).json({ error: 'New appointment time is required.' });
  }

  const targetDate = new Date(newTime);
  const now = new Date();

  if (isNaN(targetDate.getTime())) {
    return res.status(400).json({ error: 'Data de agendamento inválida.' });
  }

  if (targetDate.getTime() <= now.getTime()) {
    return res.status(400).json({ error: 'New appointment date must be in the future.' });
  }

  // Limite superior: sem isto um cliente pode empurrar o horário para o ano 9999
  // e travar a agenda do barbeiro indefinidamente.
  const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  if (targetDate > maxDate) {
    return res.status(400).json({ error: 'Só é possível agendar com até 1 ano de antecedência.' });
  }

  try {
    const clientIds = await getOwnedClientIds(req);

    // 1. Fetch current appointment details and verify ownership
    const apptCheck = await pool.query(
      `SELECT a.id, a.appointment_time, a.status, a.barber_id, a.establishment_id,
              s.duration_minutes, c.name as client_name, b.name as barber_name
       FROM appointments a
       JOIN services s ON a.service_id = s.id
       JOIN clients c ON a.client_id = c.id
       JOIN users b ON a.barber_id = b.id
       WHERE a.id = $1 AND a.client_id = ANY($2)`,
      [bookingId, clientIds]
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

    broadcastToEstablishment(String(appt.establishment_id), {
      type: 'appointment_update',
      action: 'rescheduled'
    });

    // 5. Notify via WhatsApp
    try {
      const { date: dateStr, time: timeStr } = formatZoned(targetDate);
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
  const { bookingId } = req.params;

  try {
    const clientIds = await getOwnedClientIds(req);

    const apptCheck = await pool.query(
      `SELECT a.id, a.appointment_time, a.status, a.establishment_id,
              c.name as client_name, b.name as barber_name
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       JOIN users b ON a.barber_id = b.id
       WHERE a.id = $1 AND a.client_id = ANY($2)`,
      [bookingId, clientIds]
    );

    if (apptCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found or unauthorized.' });
    }

    const appt = apptCheck.rows[0];

    if (appt.status === 'cancelled') {
      return res.status(400).json({ error: 'Este agendamento já foi cancelado.' });
    }

    if (appt.status === 'completed') {
      return res.status(400).json({ error: 'Não é possível cancelar um atendimento já concluído.' });
    }

    const apptTime = new Date(appt.appointment_time);
    const now = new Date();
    const diff = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (diff < 2) {
      return res.status(400).json({ error: 'Cannot cancel appointments with less than 2 hours of anticipation.' });
    }

    // O WHERE repete o filtro de status para que dois cliques simultâneos não
    // disparem duas notificações de cancelamento (race condition).
    const updateRes = await pool.query(
      `UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Cancelado pelo cliente via Portal'
       WHERE id = $1 AND status <> 'cancelled'
       RETURNING id`,
      [bookingId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(400).json({ error: 'Este agendamento já foi cancelado.' });
    }

    broadcastToEstablishment(String(appt.establishment_id), {
      type: 'appointment_update',
      action: 'cancelled'
    });

    // Notify
    try {
      const { date: dateStr, time: timeStr } = formatZoned(apptTime);
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
  try {
    const clientIds = await getOwnedClientIds(req);

    const apptsRes = await pool.query(
      `SELECT a.id, a.appointment_time, a.establishment_id
       FROM appointments a
       WHERE a.client_id = ANY($1) AND a.appointment_time > NOW() AND a.status = 'confirmed'`,
      [clientIds]
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
      broadcastToEstablishment(String(apptsRes.rows[0].establishment_id), {
        type: 'appointment_update',
        action: 'cancelled'
      });
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
  const { appointmentId, rating, comment } = req.body;

  const parsedRating = parseInt(rating, 10);
  if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
  }

  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    return res.status(400).json({ error: 'Comentário inválido.' });
  }

  try {
    const clientIds = await getOwnedClientIds(req);

    // Verify booking is completed and belongs to client
    const apptCheck = await pool.query(
      `SELECT id, client_id, establishment_id FROM appointments
       WHERE id = $1 AND client_id = ANY($2) AND status = 'completed'`,
      [appointmentId, clientIds]
    );

    if (apptCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Feedback can only be submitted for completed and paid appointments.' });
    }

    const { establishment_id: estId, client_id: apptClientId } = apptCheck.rows[0];

    // O índice único em feedbacks(appointment_id) é a defesa real contra duplicidade:
    // o SELECT-then-INSERT anterior permitia dois envios simultâneos passarem juntos.
    try {
      await pool.query(
        `INSERT INTO feedbacks (appointment_id, client_id, establishment_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [appointmentId, apptClientId, estId, parsedRating, comment ? String(comment).trim().slice(0, 2000) : null]
      );
    } catch (insertErr: any) {
      if (insertErr?.code === '23505') {
        return res.status(400).json({ error: 'Feedback already submitted for this appointment.' });
      }
      throw insertErr;
    }

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

  if (isNaN(targetDate.getTime())) {
    return res.status(400).json({ error: 'Data de agendamento inválida.' });
  }

  if (targetDate.getTime() <= now.getTime()) {
    return res.status(400).json({ error: 'Appointment date must be in the future.' });
  }

  const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  if (targetDate > maxDate) {
    return res.status(400).json({ error: 'Só é possível agendar com até 1 ano de antecedência.' });
  }

  try {
    // O barbeiro precisa pertencer ao estabelecimento informado e o estabelecimento
    // precisa estar ativo. Sem esta checagem, o cliente podia enviar qualquer par
    // (establishmentId, barberId) e criar agendamentos cruzados entre barbearias.
    const barberRes = await pool.query(
      `SELECT u.id
       FROM users u
       JOIN establishments e ON e.id = u.establishment_id
       WHERE u.id = $1 AND u.establishment_id = $2 AND u.role = 'barber'
         AND u.is_active = TRUE AND e.is_active = TRUE`,
      [barberId, establishmentId]
    );

    if (barberRes.rows.length === 0) {
      return res.status(400).json({ error: 'Profissional indisponível para este estabelecimento.' });
    }

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

    // Insert booking. O índice único parcial em (barber_id, appointment_time) é o
    // que realmente impede a dupla reserva: a checagem de colisão acima é apenas
    // uma cortesia de UX e sozinha sofre com TOCTOU sob concorrência.
    let result;
    try {
      result = await pool.query(
        `INSERT INTO appointments (establishment_id, barber_id, client_id, service_id, appointment_time, status)
         VALUES ($1, $2, $3, $4, $5, 'confirmed')
         RETURNING id`,
        [establishmentId, barberId, clientId, serviceId, targetDate.toISOString()]
      );

      broadcastToEstablishment(String(establishmentId), {
        type: 'appointment_update',
        action: 'created'
      });
    } catch (insertErr: any) {
      if (insertErr?.code === '23505') {
        return res.status(409).json({ error: 'This time slot is no longer available.' });
      }
      throw insertErr;
    }

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
      const { date: dateStr, time: timeStr } = formatZoned(targetDate);
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

  // `preferred_time` entra numa coluna TIME e `preferred_day_of_week` tem CHECK 0..6.
  // Validar aqui evita que um valor fora de faixa vire erro 500 opaco no banco.
  if (typeof preferredTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(preferredTime)) {
    return res.status(400).json({ error: 'Horário preferido inválido. Use o formato HH:MM.' });
  }

  const parsedDayOfWeek = Number(preferredDayOfWeek);
  if (!Number.isInteger(parsedDayOfWeek) || parsedDayOfWeek < 0 || parsedDayOfWeek > 6) {
    return res.status(400).json({ error: 'Dia da semana inválido (0 = domingo até 6 = sábado).' });
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
      [establishmentId, clientId, barberId, planType, preferredTime, parsedDayOfWeek]
    );

    // 3. Run instant recurrence scheduler generator for the next 4 weeks
    await generateFutureBookingsForPlan(client, String(establishmentId), clientId, barberId, planType, preferredTime, parsedDayOfWeek);

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
