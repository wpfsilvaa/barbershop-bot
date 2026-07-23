import { Request, Response } from 'express';
import pool from '../config/db';
import { AuthenticatedRequest } from '../middleware/auth';
import { sendOrchestratedMessage } from '../services/whatsappManager';
import { formatZoned, zonedTimeToUtc } from '../utils/datetime';
import { normalizePhone } from '../utils/phone';

/**
 * Validação comum aos dois fluxos de criação de agendamento (painel e web público).
 * Retorna a data validada ou uma mensagem de erro.
 */
const validateAppointmentTime = (raw: unknown): { date: Date } | { error: string } => {
  if (typeof raw !== 'string' && !(raw instanceof Date)) {
    return { error: 'Horário do agendamento inválido.' };
  }

  const date = new Date(raw as string);
  if (isNaN(date.getTime())) {
    return { error: 'Horário do agendamento inválido.' };
  }

  const now = Date.now();
  if (date.getTime() <= now) {
    return { error: 'O agendamento precisa ser em um horário futuro.' };
  }

  // Sem limite superior, a rota pública permitia criar agendamentos no ano 9999 e
  // poluir a agenda indefinidamente.
  if (date.getTime() > now + 365 * 24 * 60 * 60 * 1000) {
    return { error: 'Só é possível agendar com até 1 ano de antecedência.' };
  }

  return { date };
};

// Helper to generate slots
//
// `opening_time`/`closing_time` são horários LOCAIS da barbearia. A versão
// anterior fazia `new Date("2026-07-23T09:00")`, que o Node interpreta no fuso do
// processo — em um contêiner UTC (o caso padrão em produção) a agenda inteira
// aparecia deslocada em 3 horas em relação ao que o dono configurou.
const generateSlots = (
  dateStr: string,
  openingTime: string,
  closingTime: string,
  durationMinutes: number
): Date[] => {
  const slots: Date[] = [];
  const step = Number(durationMinutes) > 0 ? Number(durationMinutes) : 30;

  const start = zonedTimeToUtc(dateStr, openingTime);
  const end = zonedTimeToUtc(dateStr, closingTime);

  // Guarda contra configuração inválida (fechamento antes da abertura), que na
  // versão anterior simplesmente devolvia lista vazia sem sinalizar nada.
  if (!(start < end)) return slots;

  let current = new Date(start);
  while (current < end) {
    slots.push(new Date(current));
    current = new Date(current.getTime() + step * 60 * 1000);
  }
  return slots;
};

// Format Date/Time helper — sempre no fuso do estabelecimento, nunca no do processo.
const formatNotificationDate = (dateStr: string | Date): { date: string; time: string } =>
  formatZoned(dateStr);

// Get available slots for a barber on a specific date
export const getAvailableSlots = async (req: Request, res: Response) => {
  const { establishmentId, barberId } = req.params;
  const { date } = req.query; // YYYY-MM-DD

  // Valida o formato antes de usar a data em cálculos de fuso; um valor livre
  // gerava `Invalid Date` e a rota devolvia uma lista vazia sem explicação.
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date query parameter is required (format: YYYY-MM-DD).' });
  }

  try {
    const estResult = await pool.query(
      'SELECT opening_time, closing_time, slot_duration_minutes FROM establishments WHERE id = $1 AND is_active = TRUE',
      [establishmentId]
    );

    if (estResult.rows.length === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    // O barbeiro precisa pertencer ao estabelecimento da URL: sem esta checagem
    // a rota pública expunha a agenda de qualquer profissional de qualquer
    // barbearia, bastando trocar o barberId.
    const barberResult = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND establishment_id = $2 AND role = 'barber' AND is_active = TRUE`,
      [barberId, establishmentId]
    );

    if (barberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Professional not found in this establishment.' });
    }

    const { opening_time, closing_time, slot_duration_minutes } = estResult.rows[0];
    const slotDuration = parseInt(slot_duration_minutes, 10) || 30;

    // Janela do dia no fuso do estabelecimento. O filtro anterior
    // (`DATE(appointment_time AT TIME ZONE 'UTC') = $2`) recortava pelo dia UTC e
    // ignorava agendamentos do começo/fim do dia local, liberando horários que na
    // verdade estavam ocupados.
    const dayStart = zonedTimeToUtc(date, '00:00');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const appResult = await pool.query(
      `SELECT a.appointment_time,
              COALESCE(bs.duration_minutes, s.duration_minutes, 30) as duration_minutes
       FROM appointments a
       LEFT JOIN services s ON a.service_id = s.id
       LEFT JOIN barber_services bs ON a.service_id = bs.service_id AND bs.barber_id = a.barber_id
       WHERE a.barber_id = $1
         AND a.appointment_time >= $2 AND a.appointment_time < $3
         AND a.status != 'cancelled'`,
      [barberId, dayStart.toISOString(), dayEnd.toISOString()]
    );

    const bookedIntervals = appResult.rows.map((row) => {
      const start = new Date(row.appointment_time).getTime();
      const duration = parseInt(row.duration_minutes, 10) || 30;
      return {
        start,
        end: start + duration * 60 * 1000
      };
    });

    const allSlots = generateSlots(date, opening_time, closing_time, slotDuration);
    const now = new Date();

    const availableSlots = allSlots.filter((slot) => {
      const slotStart = slot.getTime();
      const slotEnd = slotStart + slotDuration * 60 * 1000;

      if (slotStart <= now.getTime()) {
        return false;
      }

      // Sobreposição real de intervalos. A checagem anterior só olhava o início do
      // slot, então um agendamento de 10:15–10:45 não bloqueava o slot 10:00–10:30
      // e o cliente conseguia marcar em cima do horário de outra pessoa.
      const isOverlap = bookedIntervals.some(
        (interval) => slotStart < interval.end && slotEnd > interval.start
      );
      return !isOverlap;
    });

    return res.json(availableSlots.map(slot => slot.toISOString()));
  } catch (error) {
    console.error('Get available slots error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// List all appointments (Authenticated)
export const listAppointments = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId } = req.params;

  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    let query = `
      SELECT a.id, a.appointment_time, a.status, a.cancellation_reason, a.created_at,
             b.id as barber_id, b.name as barber_name, b.email as barber_email,
             c.id as client_id, c.name as client_name, c.phone as client_phone,
             s.id as service_id, s.name as service_name, s.price as service_price
      FROM appointments a
      JOIN users b ON a.barber_id = b.id
      JOIN clients c ON a.client_id = c.id
      LEFT JOIN services s ON a.service_id = s.id
      WHERE a.establishment_id = $1
    `;
    const queryParams: any[] = [establishmentId];

    if (req.user.role === 'barber') {
      query += ' AND a.barber_id = $2';
      queryParams.push(req.user.id);
    }

    query += ' ORDER BY a.appointment_time ASC';

    const result = await pool.query(query, queryParams);
    return res.json(result.rows);
  } catch (error) {
    console.error('List appointments error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Create an appointment manually (Authenticated Dashboard)
export const createAppointment = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId } = req.params;
  const { barber_id, client_name, appointment_time, service_id } = req.body;

  if (!barber_id || !client_name || !req.body.client_phone || !appointment_time) {
    return res.status(400).json({ error: 'Barber ID, client name, client phone, and appointment time are required.' });
  }

  const validated = validateAppointmentTime(appointment_time);
  if ('error' in validated) {
    return res.status(400).json({ error: validated.error });
  }

  const client_phone = normalizePhone(req.body.client_phone);
  if (client_phone.length < 12) {
    return res.status(400).json({ error: 'Telefone do cliente inválido. Informe DDD + número.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const barberCheck = await client.query(
      `SELECT u.id, u.name as barber_name, e.name as establishment_name 
       FROM users u
       JOIN establishments e ON u.establishment_id = e.id
       WHERE u.id = $1 AND u.establishment_id = $2 AND u.role = 'barber'`,
      [barber_id, establishmentId]
    );

    if (barberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid barber for this establishment.' });
    }

    const { barber_name, establishment_name } = barberCheck.rows[0];

    let serviceName = '';
    if (service_id) {
      const serviceCheck = await client.query(
        `SELECT s.name, COALESCE(bs.price, s.price) as price 
         FROM services s
         LEFT JOIN barber_services bs ON s.id = bs.service_id AND bs.barber_id = $1
         WHERE s.id = $2`,
        [barber_id, service_id]
      );
      if (serviceCheck.rows.length > 0) {
        serviceName = `${serviceCheck.rows[0].name} (R$ ${parseFloat(serviceCheck.rows[0].price).toFixed(2)})`;
      }
    }

    let clientId: string;
    const clientCheck = await client.query(
      'SELECT id FROM clients WHERE phone = $1 AND establishment_id = $2',
      [client_phone, establishmentId]
    );

    if (clientCheck.rows.length > 0) {
      clientId = clientCheck.rows[0].id;
      await client.query('UPDATE clients SET name = $1 WHERE id = $2', [client_name, clientId]);
    } else {
      // Check if client exists globally (registered via client portal)
      const globalClientCheck = await client.query(
        'SELECT id FROM clients WHERE phone = $1 AND establishment_id IS NULL LIMIT 1',
        [client_phone]
      );
      if (globalClientCheck.rows.length > 0) {
        clientId = globalClientCheck.rows[0].id;
        await client.query(
          'UPDATE clients SET establishment_id = $1, name = $2 WHERE id = $3',
          [establishmentId, client_name, clientId]
        );
      } else {
        const newClient = await client.query(
          'INSERT INTO clients (establishment_id, name, phone) VALUES ($1, $2, $3) RETURNING id',
          [establishmentId, client_name, client_phone]
        );
        clientId = newClient.rows[0].id;
      }
    }

    const timeCheck = await client.query(
      `SELECT id FROM appointments
       WHERE barber_id = $1 AND appointment_time = $2 AND status != 'cancelled'`,
      [barber_id, validated.date.toISOString()]
    );

    if (timeCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This time slot is already booked for this professional.' });
    }

    const result = await client.query(
      `INSERT INTO appointments (establishment_id, barber_id, client_id, appointment_time, status, service_id)
       VALUES ($1, $2, $3, $4, 'confirmed', $5)
       RETURNING id, appointment_time, status, service_id`,
      [establishmentId, barber_id, clientId, validated.date.toISOString(), service_id || null]
    );

    await client.query('COMMIT');

    const timeInfo = formatNotificationDate(validated.date);
    const messageText = `✅ *Horário Reservado Manualmente!*\n\nOlá, *${client_name}*!\n\nConfirmamos o agendamento do seu horário:\n\n` +
                        `*Estabelecimento:* ${establishment_name}\n` +
                        (serviceName ? `*Serviço:* ${serviceName}\n` : '') +
                        `*Profissional:* ${barber_name}\n` +
                        `*Data:* ${timeInfo.date}\n` +
                        `*Horário:* ${timeInfo.time}\n\nQualquer dúvida, entre em contato. Até breve! 💈`;

    sendOrchestratedMessage(String(establishmentId), client_phone, messageText).catch((e) => {
      console.error('Failed to send manual booking WhatsApp notification:', e);
    });

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    await client.query('ROLLBACK');
    // 23505 = violação do índice único (barber_id, appointment_time). É a corrida
    // entre dois pedidos simultâneos para o mesmo horário: erro de negócio, não 500.
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'This time slot is already booked for this professional.' });
    }
    console.error('Create appointment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
};

// Reschedule/Update Appointment (Authenticated Dashboard)
// Triggers WhatsApp notification to the client.
export const updateAppointment = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId, bookingId } = req.params;
  const { barber_id, appointment_time, reason } = req.body;

  if (!barber_id || !appointment_time) {
    return res.status(400).json({ error: 'Barber ID and appointment time are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch current appointment details (for notifications reference)
    const currentAppt = await client.query(
      `SELECT a.appointment_time, a.barber_id,
              b.name as barber_name, c.name as client_name, c.phone as client_phone
       FROM appointments a
       JOIN users b ON a.barber_id = b.id
       JOIN clients c ON a.client_id = c.id
       WHERE a.id = $1 AND a.establishment_id = $2`,
      [bookingId, establishmentId]
    );

    if (currentAppt.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    const appt = currentAppt.rows[0];

    // Um barbeiro só mexe na própria agenda. Sem isto, qualquer barbeiro podia
    // remarcar (e transferir para si) o agendamento de um colega.
    if (req.user?.role === 'barber' && appt.barber_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied. You cannot modify appointments of another barber.' });
    }

    // Barber check
    const barberCheck = await client.query(
      'SELECT id, name FROM users WHERE id = $1 AND establishment_id = $2 AND role = \'barber\'',
      [barber_id, establishmentId]
    );

    if (barberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid barber selected.' });
    }

    const newBarberName = barberCheck.rows[0].name;

    // Double booking check for the new time slot
    const timeCheck = await client.query(
      `SELECT id FROM appointments 
       WHERE id != $1 AND barber_id = $2 AND appointment_time = $3 AND status != 'cancelled'`,
      [bookingId, barber_id, appointment_time]
    );

    if (timeCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected time slot is already booked for this professional.' });
    }

    // Update appointment
    const result = await client.query(
      `UPDATE appointments 
       SET barber_id = $1, appointment_time = $2, status = 'confirmed', cancellation_reason = NULL
       WHERE id = $3 AND establishment_id = $4
       RETURNING id, appointment_time, status`,
      [barber_id, appointment_time, bookingId, establishmentId]
    );

    await client.query('COMMIT');

    // Send WhatsApp notification to client
    const oldTime = formatNotificationDate(appt.appointment_time);
    const newTime = formatNotificationDate(appointment_time);
    
    const messageText = `🔔 *Alteração de Horário*\n\nOlá, *${appt.client_name}*! Seu agendamento foi alterado pelo profissional.\n\n` +
                        `*De:* ${oldTime.date} às ${oldTime.time} com ${appt.barber_name}\n` +
                        `*Para:* ${newTime.date} às ${newTime.time} com ${newBarberName}\n` +
                        `*Motivo:* ${reason || 'Ajuste de agenda'}\n\nTe esperamos lá! 💈`;

    sendOrchestratedMessage(String(establishmentId), appt.client_phone, messageText).catch((e) => {
      console.error('Failed to send reschedule WhatsApp notification:', e);
    });

    return res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update appointment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
};

// Cancel an appointment (Authenticated Dashboard)
// Triggers WhatsApp notification to the client with reason.
export const cancelAppointment = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId, bookingId } = req.params;
  const { reason } = req.body; // Motivo do cancelamento

  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    // 1. Fetch details before cancelling
    const apptQuery = await pool.query(
      `SELECT a.appointment_time, a.barber_id,
              b.name as barber_name, c.name as client_name, c.phone as client_phone
       FROM appointments a
       JOIN users b ON a.barber_id = b.id
       JOIN clients c ON a.client_id = c.id
       WHERE a.id = $1 AND a.establishment_id = $2`,
      [bookingId, establishmentId]
    );

    if (apptQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found in this establishment.' });
    }

    const appt = apptQuery.rows[0];

    // Barber permissions check
    if (req.user.role === 'barber' && appt.barber_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied. You cannot cancel appointments of another barber.' });
    }

    // Cancel appointment
    await pool.query(
      `UPDATE appointments 
       SET status = 'cancelled', cancellation_reason = $1 
       WHERE id = $2 AND establishment_id = $3`,
      [reason || 'Cancelado pelo profissional', bookingId, establishmentId]
    );

    // Send WhatsApp notification
    const timeInfo = formatNotificationDate(appt.appointment_time);
    
    const messageText = `❌ *Agendamento Cancelado*\n\nOlá, *${appt.client_name}*!\n\nSeu agendamento para o dia *${timeInfo.date}* às *${timeInfo.time}* com o profissional *${appt.barber_name}* foi cancelado.\n\n` +
                        `*Motivo:* ${reason || 'Não informado'}\n\nCaso queira reagendar, basta nos enviar uma nova mensagem! 💈`;

    sendOrchestratedMessage(String(establishmentId), appt.client_phone, messageText).catch((e) => {
      console.error('Failed to send cancellation WhatsApp notification:', e);
    });

    return res.json({ message: 'Appointment cancelled and client notified successfully.' });
  } catch (error) {
    console.error('Cancel appointment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Create a public booking from client web app (Unauthenticated)
export const createPublicAppointment = async (req: Request, res: Response) => {
  const { establishmentId } = req.params;
  const { barber_id, client_name, appointment_time, service_id } = req.body;

  if (!barber_id || !client_name || !req.body.client_phone || !appointment_time) {
    return res.status(400).json({ error: 'Barber ID, client name, client phone, and appointment time are required.' });
  }

  // Endpoint sem autenticação: toda validação de entrada precisa acontecer aqui.
  const validated = validateAppointmentTime(appointment_time);
  if ('error' in validated) {
    return res.status(400).json({ error: validated.error });
  }

  const client_phone = normalizePhone(req.body.client_phone);
  if (client_phone.length < 12) {
    return res.status(400).json({ error: 'Telefone inválido. Informe DDD + número.' });
  }

  const trimmedName = String(client_name).trim();
  if (trimmedName.length < 2 || trimmedName.length > 255) {
    return res.status(400).json({ error: 'Nome do cliente inválido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch establishment and barber details. O estabelecimento precisa estar
    // ativo: sem isso, uma barbearia suspensa continuava recebendo agendamentos
    // pelo link público.
    const barberCheck = await client.query(
      `SELECT u.id, u.name as barber_name, e.name as establishment_name
       FROM users u
       JOIN establishments e ON u.establishment_id = e.id
       WHERE u.id = $1 AND u.establishment_id = $2 AND u.role = 'barber'
         AND u.is_active = TRUE AND e.is_active = TRUE`,
      [barber_id, establishmentId]
    );

    if (barberCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid barber for this establishment.' });
    }

    const { barber_name, establishment_name } = barberCheck.rows[0];

    let serviceName = '';
    if (service_id) {
      const serviceCheck = await client.query(
        `SELECT s.name, COALESCE(bs.price, s.price) as price 
         FROM services s
         LEFT JOIN barber_services bs ON s.id = bs.service_id AND bs.barber_id = $1
         WHERE s.id = $2`,
        [barber_id, service_id]
      );
      if (serviceCheck.rows.length > 0) {
        serviceName = `${serviceCheck.rows[0].name} (R$ ${parseFloat(serviceCheck.rows[0].price).toFixed(2)})`;
      }
    }

    let clientId: string;
    const clientCheck = await client.query(
      'SELECT id FROM clients WHERE phone = $1 AND establishment_id = $2',
      [client_phone, establishmentId]
    );

    if (clientCheck.rows.length > 0) {
      clientId = clientCheck.rows[0].id;
      await client.query('UPDATE clients SET name = $1 WHERE id = $2', [client_name, clientId]);
    } else {
      // Check if client exists globally (registered via client portal)
      const globalClientCheck = await client.query(
        'SELECT id FROM clients WHERE phone = $1 AND establishment_id IS NULL LIMIT 1',
        [client_phone]
      );
      if (globalClientCheck.rows.length > 0) {
        clientId = globalClientCheck.rows[0].id;
        await client.query(
          'UPDATE clients SET establishment_id = $1, name = $2 WHERE id = $3',
          [establishmentId, client_name, clientId]
        );
      } else {
        const newClient = await client.query(
          'INSERT INTO clients (establishment_id, name, phone) VALUES ($1, $2, $3) RETURNING id',
          [establishmentId, client_name, client_phone]
        );
        clientId = newClient.rows[0].id;
      }
    }

    const timeCheck = await client.query(
      `SELECT id FROM appointments 
       WHERE barber_id = $1 AND appointment_time = $2 AND status != 'cancelled'`,
      [barber_id, validated.date.toISOString()]
    );

    if (timeCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This time slot is already booked for this professional.' });
    }

    const result = await client.query(
      `INSERT INTO appointments (establishment_id, barber_id, client_id, appointment_time, status, service_id)
       VALUES ($1, $2, $3, $4, 'confirmed', $5)
       RETURNING id, appointment_time, status, service_id`,
      [establishmentId, barber_id, clientId, validated.date.toISOString(), service_id || null]
    );

    await client.query('COMMIT');

    // Send WhatsApp notification
    const timeInfo = formatNotificationDate(validated.date);
    const messageText = `✅ *Agendamento Confirmado via Web App!*\n\nOlá, *${client_name}*!\n\nSeu horário foi reservado com sucesso no nosso site:\n\n` +
                        `*Estabelecimento:* ${establishment_name}\n` +
                        (serviceName ? `*Serviço:* ${serviceName}\n` : '') +
                        `*Profissional:* ${barber_name}\n` +
                        `*Data:* ${timeInfo.date}\n` +
                        `*Horário:* ${timeInfo.time}\n\nTe esperamos lá! 💈`;

    sendOrchestratedMessage(String(establishmentId), client_phone, messageText).catch((e) => {
      console.error('Failed to send public booking WhatsApp notification:', e);
    });

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'This time slot is already booked for this professional.' });
    }
    console.error('Create public appointment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
};

// 7. Mark appointment as completed/paid (Authenticated Dashboard)
export const completeAppointment = async (req: AuthenticatedRequest, res: Response) => {
  const { establishmentId, bookingId } = req.params;

  try {
    // Um barbeiro só pode concluir os próprios atendimentos — a rota alimenta os
    // relatórios de faturamento e comissão, então dar baixa no agendamento de
    // outro profissional distorce o cálculo financeiro dele.
    const ownershipCheck = await pool.query(
      'SELECT barber_id, status FROM appointments WHERE id = $1 AND establishment_id = $2',
      [bookingId, establishmentId]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (req.user?.role === 'barber' && ownershipCheck.rows[0].barber_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied. You cannot complete appointments of another barber.' });
    }

    if (ownershipCheck.rows[0].status === 'cancelled') {
      return res.status(400).json({ error: 'Não é possível concluir um agendamento cancelado.' });
    }

    // `status <> 'completed'` impede que dois cliques disparem duas mensagens de
    // agradecimento para o mesmo atendimento.
    const result = await pool.query(
      `UPDATE appointments
       SET status = 'completed'
       WHERE id = $1 AND establishment_id = $2 AND status <> 'completed'
       RETURNING id, status`,
      [bookingId, establishmentId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Este atendimento já foi concluído.' });
    }

    // Send thank you message on WhatsApp
    const details = await pool.query(
      `SELECT c.name as client_name, c.phone as client_phone, e.name as establishment_name
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       JOIN establishments e ON a.establishment_id = e.id
       WHERE a.id = $1`,
      [bookingId]
    );

    if (details.rows.length > 0) {
      const { client_name, client_phone, establishment_name } = details.rows[0];
      const messageText = `💵 *Atendimento Finalizado!*\n\nOlá, *${client_name}*!\n\nAgradecemos a preferência no *${establishment_name}*.\nSeu atendimento foi concluído e registrado como pago com sucesso! 💈\n\nAté a próxima! 👋`;
      
      sendOrchestratedMessage(String(establishmentId), client_phone, messageText).catch((e) => {
        console.error('Failed to send thank you WhatsApp notification:', e);
      });
    }

    return res.json({ message: 'Appointment marked as completed and paid.' });
  } catch (error) {
    console.error('Complete appointment error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
