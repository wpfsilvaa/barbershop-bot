import { Router } from 'express';
import crypto from 'crypto';
import pool from './config/db';
import { login, getMe, registerOwner, changeTempPassword } from './controllers/authController';
import { listBarbers, createBarber, updateBarber, deleteBarber, listPublicBarbers } from './controllers/barberController';
import { getEstablishment, getEstablishmentBySlug, updateEstablishment, listEstablishments } from './controllers/establishmentController';
import { 
  listServices, 
  listPublicServices, 
  createService, 
  updateService, 
  deleteService, 
  listBarberServices, 
  assignBarberServices 
} from './controllers/serviceController';
import { 
  getAvailableSlots, 
  listAppointments, 
  createAppointment, 
  updateAppointment, 
  cancelAppointment,
  createPublicAppointment,
  completeAppointment
} from './controllers/bookingController';
import { listPlans, createOrUpdatePlan, deletePlan } from './controllers/planController';
import { 
  listEstablishmentClients, 
  updateEstablishmentClient, 
  getPromoConfig, 
  updatePromoConfig, 
  sendPromoCampaign,
  listEstablishmentFeedbacks,
  createEstablishmentClient,
  deleteEstablishmentClient
} from './controllers/crmController';
import { verifyToken, requireRole, checkEstablishmentAccess, AuthenticatedRequest } from './middleware/auth';
import { authRateLimiter, apiRateLimiter, internalWebhookAuth } from './middleware/security';
import { isSamePhone, normalizePhone } from './utils/phone';
import { subscribeToChatUpdates } from './services/chatEvents';
import { 
  startWhatsAppSession, 
  disconnectWhatsAppSession,
  getActiveChats,
  pauseChatBot,
  resumeChatBot,
  terminateChatSession,
  sendManualMessage
} from './services/whatsappManager';

import { 
  listAllUsers, 
  changeUserPassword, 
  listWhatsAppSessions, 
  logoutWhatsAppSession, 
  getEstablishmentMetrics,
  getGlobalMetrics,
  updateEstablishmentCommission,
  updateEstablishmentStatus,
  updateEstablishmentLicense,
  deleteEstablishment,
  startWhatsAppSessionAdmin
} from './controllers/adminController';

import { sendOrchestratedMessage } from './services/whatsappManager';

import {
  authClient,
  getClientData,
  getEstablishmentDetails,
  rescheduleBooking,
  cancelClientBooking,
  cancelAllClientBookings,
  createFeedback,
  clientBookAppointment,
  subscribeToPlan
} from './controllers/clientPortalController';

const router = Router();

// Estabelecimento "Sistema BarberHub", dono da sessão WhatsApp usada para
// notificações da plataforma (credenciais de acesso, avisos de vencimento).
const SYSTEM_ESTABLISHMENT_ID = '00000000-0000-0000-0000-000000000000';

// ==========================================
// PUBLIC ROUTES
// ==========================================

// Auth
router.post('/auth/login', authRateLimiter, login);

// Public list of all establishments (Landing Page)
router.get('/establishments', apiRateLimiter, listEstablishments);

// Public list of active services for an establishment (for Web Booking)
router.get('/establishments/:establishmentId/public-services', apiRateLimiter, listPublicServices);

// Public list of active services assigned to a barber (for Web Booking)
router.get('/establishments/:establishmentId/barbers/:barberId/services', apiRateLimiter, listBarberServices);

// Public Establishment Info (for styling and dynamic palette loading before login)
router.get('/establishments/slug/:slug', apiRateLimiter, getEstablishmentBySlug);

// Public Barber List (for Web App)
router.get(
  '/establishments/:establishmentId/public-barbers',
  apiRateLimiter,
  listPublicBarbers
);

// Public Booking helper: get available slots
router.get(
  '/establishments/:establishmentId/barbers/:barberId/available-slots',
  apiRateLimiter,
  getAvailableSlots
);

// Public Booking creation (for Web App)
router.post(
  '/establishments/:establishmentId/public-bookings',
  apiRateLimiter,
  createPublicAppointment
);

// ==========================================
// PROTECTED ROUTES (JWT REQUIRED)
// ==========================================

// Load session details
router.get('/auth/me', verifyToken, getMe);
router.post('/auth/change-temp-password', verifyToken, changeTempPassword);

// Establishment configurations
router.get(
  '/establishments/:establishmentId',
  verifyToken,
  checkEstablishmentAccess,
  getEstablishment
);
router.put(
  '/establishments/:establishmentId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  updateEstablishment
);

// Barbers Management
router.get(
  '/establishments/:establishmentId/barbers',
  verifyToken,
  checkEstablishmentAccess,
  listBarbers
);
router.post(
  '/establishments/:establishmentId/barbers',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  createBarber
);
router.put(
  '/establishments/:establishmentId/barbers/:barberId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  updateBarber
);
router.delete(
  '/establishments/:establishmentId/barbers/:barberId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  deleteBarber
);

// Services Management
router.get(
  '/establishments/:establishmentId/services',
  verifyToken,
  checkEstablishmentAccess,
  listServices
);
router.post(
  '/establishments/:establishmentId/services',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  createService
);
router.put(
  '/establishments/:establishmentId/services/:serviceId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  updateService
);
router.delete(
  '/establishments/:establishmentId/services/:serviceId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  deleteService
);
router.post(
  '/establishments/:establishmentId/barbers/:barberId/services',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  assignBarberServices
);

// Appointments Management
router.get(
  '/establishments/:establishmentId/bookings',
  verifyToken,
  checkEstablishmentAccess,
  listAppointments
);
router.post(
  '/establishments/:establishmentId/bookings',
  verifyToken,
  checkEstablishmentAccess,
  createAppointment
);
router.put(
  '/establishments/:establishmentId/bookings/:bookingId',
  verifyToken,
  checkEstablishmentAccess,
  updateAppointment
);
router.delete(
  '/establishments/:establishmentId/bookings/:bookingId',
  verifyToken,
  checkEstablishmentAccess,
  cancelAppointment
);
router.post(
  '/establishments/:establishmentId/bookings/:bookingId/complete',
  verifyToken,
  checkEstablishmentAccess,
  completeAppointment
);

// Recurring Plans Management
router.get(
  '/establishments/:establishmentId/plans',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  listPlans
);
router.post(
  '/establishments/:establishmentId/plans',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  createOrUpdatePlan
);
router.delete(
  '/establishments/:establishmentId/plans/:planId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  deletePlan
);

// Digital Loyalty Card Route for Client Portal
//
// Antes esta rota era pública: qualquer pessoa podia iterar números de telefone e
// descobrir quem é cliente de qual barbearia e com que frequência frequenta.
// Agora exige token de cliente e só devolve os dados do próprio telefone.
router.get('/client-portal/loyalty/:phone', verifyToken, requireRole(['client']), async (req: AuthenticatedRequest, res) => {
  const phone = String(req.params.phone || '');
  const cleanPhone = normalizePhone(phone);

  if (!isSamePhone(phone, req.user?.phone)) {
    return res.status(403).json({ error: 'Você só pode consultar a fidelidade do seu próprio número.' });
  }

  try {
    const resCount = await pool.query(
      `SELECT COUNT(a.id) as completed_count
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE c.phone = $1 AND a.status = 'completed'`,
      [cleanPhone]
    );

    const completed = parseInt(resCount.rows[0]?.completed_count || '0', 10);
    const stamps = completed % 10;
    const totalNeeded = 10;
    const rewardAvailable = completed > 0 && stamps === 0;

    return res.json({
      phone: cleanPhone,
      completedTotal: completed,
      stamps,
      totalNeeded,
      rewardAvailable,
      rewardDescription: 'Corte ou Barba Grátis no 10º Agendamento!'
    });
  } catch (err) {
    console.error('Loyalty card query error:', err);
    return res.status(500).json({ error: 'Erro ao consultar fidelidade.' });
  }
});

// Contacts (Clients) and Promotions Marketing CRM Routes
router.get(
  '/establishments/:establishmentId/clients',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  listEstablishmentClients
);
router.post(
  '/establishments/:establishmentId/clients',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  createEstablishmentClient
);
router.put(
  '/establishments/:establishmentId/clients/:clientId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  updateEstablishmentClient
);
router.delete(
  '/establishments/:establishmentId/clients/:clientId',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  deleteEstablishmentClient
);
router.get(
  '/establishments/:establishmentId/promo-config',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  getPromoConfig
);
router.put(
  '/establishments/:establishmentId/promo-config',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  updatePromoConfig
);
router.post(
  '/establishments/:establishmentId/send-promo',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  sendPromoCampaign
);
router.get(
  '/establishments/:establishmentId/feedbacks',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  listEstablishmentFeedbacks
);

// WhatsApp Multi-Tenant Connection Manager Routes
router.get(
  '/establishments/:establishmentId/bot/status',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  async (req, res) => {
    const { establishmentId } = req.params;
    try {
      const result = await pool.query(
        'SELECT status, qr_code, phone, updated_at FROM whatsapp_sessions WHERE establishment_id = $1',
        [establishmentId]
      );

      if (result.rows.length === 0) {
        // If not registered yet, start connection asynchronously
        startWhatsAppSession(String(establishmentId)).catch(e => console.error(e));
        return res.json({ status: 'connecting', qr: null, phone: null });
      }

      const { status, qr_code, phone, updated_at } = result.rows[0];
      const isStale = updated_at ? (Date.now() - new Date(updated_at).getTime() > 45000) : false;

      if (status === 'disconnected' || ((status === 'qr_ready' || status === 'connecting') && isStale)) {
        startWhatsAppSession(String(establishmentId)).catch(e => console.error(e));
        return res.json({ status: 'connecting', qr: null, phone: null });
      }

      return res.json({ status, qr: qr_code, phone });
    } catch (err) {
      console.error('Fetch bot status error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

router.post(
  '/establishments/:establishmentId/bot/disconnect',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  async (req, res) => {
    const { establishmentId } = req.params;
    try {
      await disconnectWhatsAppSession(String(establishmentId));
      return res.json({ message: 'WhatsApp disconnected successfully.' });
    } catch (err) {
      console.error('Disconnect bot error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// Helper para verificar se o barbeiro pode acessar um telefone específico baseado nos agendamentos de hoje
//
// A comparação anterior (`targetPhone.endsWith(phone.slice(-9))`) tinha dois furos:
// um cadastro com telefone vazio virava `endsWith('')`, que é sempre verdadeiro e
// liberava TODAS as conversas da barbearia para qualquer barbeiro; e um sufixo de 9
// dígitos podia colidir entre números distintos. `isSamePhone` normaliza os dois
// lados e rejeita valores curtos demais (fail-secure).
async function checkBarberChatAccess(barberId: string, establishmentId: string, targetPhone: string): Promise<boolean> {
  if (!normalizePhone(targetPhone)) return false;

  const appointmentsToday = await pool.query(
    `SELECT c.phone
     FROM appointments a
     JOIN clients c ON a.client_id = c.id
     WHERE a.barber_id = $1
       AND a.establishment_id = $2
       AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE
       AND a.status != 'cancelled'`,
    [barberId, establishmentId]
  );

  return appointmentsToday.rows.some((row) => isSamePhone(targetPhone, row.phone));
}

// Active Conversational Sessions Routes
router.get(
  '/establishments/:establishmentId/bot/chats',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId } = req.params;
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {
      let chats = await getActiveChats(String(establishmentId));

      if (req.user.role === 'barber') {
        const barberId = req.user.id;
        const appointmentsToday = await pool.query(
          `SELECT c.phone 
           FROM appointments a
           JOIN clients c ON a.client_id = c.id
           WHERE a.barber_id = $1 
             AND a.establishment_id = $2 
             AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE
             AND a.status != 'cancelled'`,
          [barberId, establishmentId]
        );

        const clientPhones = appointmentsToday.rows.map((row) => row.phone);

        chats = chats.filter((chat) => clientPhones.some((phone) => isSamePhone(chat.phone, phone)));
      }

      return res.json(chats);
    } catch (err) {
      console.error('Fetch bot chats error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

router.post(
  '/establishments/:establishmentId/bot/chats/:phone/pause',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId, phone } = req.params;
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {
      if (req.user.role === 'barber') {
        const hasAccess = await checkBarberChatAccess(req.user.id, String(establishmentId), String(phone));
        if (!hasAccess) {
          return res.status(403).json({ error: 'Permission denied. Você só pode interagir com clientes marcados hoje com você.' });
        }
      }

      pauseChatBot(String(establishmentId), String(phone));
      return res.json({ message: 'Bot paused successfully for this contact.' });
    } catch (err) {
      console.error('Pause bot chat error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

router.post(
  '/establishments/:establishmentId/bot/chats/:phone/resume',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId, phone } = req.params;
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {
      if (req.user.role === 'barber') {
        const hasAccess = await checkBarberChatAccess(req.user.id, String(establishmentId), String(phone));
        if (!hasAccess) {
          return res.status(403).json({ error: 'Permission denied. Você só pode interagir com clientes marcados hoje com você.' });
        }
      }

      resumeChatBot(String(establishmentId), String(phone));
      return res.json({ message: 'Bot resumed successfully for this contact.' });
    } catch (err) {
      console.error('Resume bot chat error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// Webhook to receive real-time message events from WhatsApp workers and broadcast via WebSocket
//
// Rota máquina-a-máquina (gateway do WhatsApp -> backend). Estava sem qualquer
// autenticação: qualquer pessoa na internet podia injetar mensagens falsas no
// painel de qualquer barbearia — basta conhecer/adivinhar o UUID. Agora exige o
// segredo compartilhado INTERNAL_API_KEY, comparado em tempo constante.
router.post(
  '/bot/webhook-event',
  internalWebhookAuth,
  async (req, res) => {
    const { establishmentId, event, phone, pushName, state, message } = req.body || {};
    if (!establishmentId || typeof establishmentId !== 'string') {
      return res.status(400).json({ error: 'establishmentId is required.' });
    }

    try {
      const { broadcastToEstablishment } = require('./services/wsServer');
      broadcastToEstablishment(establishmentId, {
        type: 'chat_update',
        event,
        phone,
        pushName,
        state,
        message
      });
      return res.json({ status: 'OK' });
    } catch (err: any) {
      console.error('[WebhookEvent] Failed to broadcast event:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

router.post(
  '/establishments/:establishmentId/bot/chats/:phone/message',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId, phone } = req.params;
    const { message } = req.body;
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    try {
      if (req.user.role === 'barber') {
        const hasAccess = await checkBarberChatAccess(req.user.id, String(establishmentId), String(phone));
        if (!hasAccess) {
          return res.status(403).json({ error: 'Permission denied. Você só pode interagir com clientes marcados hoje com você.' });
        }
      }

      // Formata a identificação do atendente na mensagem
      const roleLabel = req.user.role === 'owner' 
        ? 'Proprietário' 
        : req.user.role === 'admin' 
          ? 'Administrador' 
          : 'Barbeiro';
      
      const formattedMessage = `*[${roleLabel}] ${req.user.name}:*\n${message}`;

      const realJid = await sendManualMessage(
        String(establishmentId),
        String(phone),
        formattedMessage,
        { id: req.user.id, name: req.user.name }
      );
      return res.json({ message: 'Message sent and bot paused.', realJid, formattedMessage });
    } catch (err: any) {
      console.error('Send manual message error:', err);
      return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  }
);

router.delete(
  '/establishments/:establishmentId/bot/chats/:phone',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId, phone } = req.params;
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {
      if (req.user.role === 'barber') {
        const hasAccess = await checkBarberChatAccess(req.user.id, String(establishmentId), String(phone));
        if (!hasAccess) {
          return res.status(403).json({ error: 'Permission denied. Você só pode interagir com clientes marcados hoje com você.' });
        }
      }

      const { message } = req.body || {};
      if (message && typeof message === 'string' && message.trim() !== '') {
        const roleLabel = req.user.role === 'owner' 
          ? 'Proprietário' 
          : req.user.role === 'admin' 
            ? 'Administrador' 
            : 'Barbeiro';
        
        const formattedMessage = `*[${roleLabel}] ${req.user.name}:*\n${message.trim()}`;
        await sendManualMessage(
          String(establishmentId),
          String(phone),
          formattedMessage,
          { id: req.user.id, name: req.user.name }
        );
      }

      terminateChatSession(String(establishmentId), String(phone));
      return res.json({ message: 'Chat session terminated successfully.' });
    } catch (err) {
      console.error('Terminate bot chat error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// Real-Time SSE (Server-Sent Events) Stream for Chat Updates
router.get(
  '/establishments/:establishmentId/bot/chats/sse',
  verifyToken,
  checkEstablishmentAccess,
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected', establishmentId })}\n\n`);

    const isSystemAdmin = req.user?.role === 'admin';

    // Assina o broker compartilhado (uma única conexão Redis por processo) em vez
    // de abrir uma conexão nova a cada requisição SSE.
    const unsubscribe = subscribeToChatUpdates((data) => {
      // Só o super admin recebe o fluxo global ('all'); os demais ficam restritos
      // ao próprio estabelecimento, mesmo que forjem o parâmetro da URL.
      const allowed = isSystemAdmin
        ? establishmentId === 'all' || data.establishmentId === establishmentId
        : data.establishmentId === establishmentId;

      if (!allowed) return;

      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Conexão já encerrada pelo cliente.
      }
    });

    // Keep SSE connection alive with 15s heartbeat pings
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // ignore
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(pingInterval);
      unsubscribe();
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
  }
);

// ==========================================
// SUPER ADMIN & METRICS ROUTES
// ==========================================

// ==========================================
// EXECUTIVE ANALYTICS, COMMISSIONS & CAMPAIGNS
// ==========================================

router.get(
  '/establishments/:establishmentId/executive-analytics',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId } = req.params;

    try {
      // 1. Revenue Today
      const revTodayRes = await pool.query(
        `SELECT COALESCE(SUM(s.price), 0) as total, COUNT(a.id) as count
         FROM appointments a
         JOIN services s ON a.service_id = s.id
         WHERE a.establishment_id = $1 
           AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE
           AND a.status != 'cancelled'`,
        [establishmentId]
      );

      // 2. Revenue Month
      const revMonthRes = await pool.query(
        `SELECT COALESCE(SUM(s.price), 0) as total, COUNT(a.id) as count
         FROM appointments a
         JOIN services s ON a.service_id = s.id
         WHERE a.establishment_id = $1 
           AND DATE_TRUNC('month', a.appointment_time AT TIME ZONE 'UTC') = DATE_TRUNC('month', CURRENT_DATE)
           AND a.status != 'cancelled'`,
        [establishmentId]
      );

      // 3. Barber Commissions Breakdown (Default 50% commission rate)
      const commissionsRes = await pool.query(
        `SELECT u.id as barber_id, u.name as barber_name, 
                COUNT(a.id) as total_services, 
                COALESCE(SUM(s.price), 0) as total_revenue,
                ROUND(COALESCE(SUM(s.price), 0) * 0.50, 2) as commission_earned
         FROM users u
         LEFT JOIN appointments a ON u.id = a.barber_id 
           AND a.establishment_id = $1 
           AND DATE_TRUNC('month', a.appointment_time AT TIME ZONE 'UTC') = DATE_TRUNC('month', CURRENT_DATE)
           AND a.status != 'cancelled'
         LEFT JOIN services s ON a.service_id = s.id
         WHERE u.establishment_id = $1 AND u.role IN ('owner', 'admin', 'barber')
         GROUP BY u.id, u.name
         ORDER BY total_revenue DESC`,
        [establishmentId]
      );

      // 4. Inactive Clients (no appointment in last 30 days)
      const inactiveClientsRes = await pool.query(
        `SELECT c.id, c.name, c.phone, MAX(a.appointment_time) as last_appointment
         FROM clients c
         LEFT JOIN appointments a ON c.id = a.client_id
         WHERE c.establishment_id = $1
         GROUP BY c.id, c.name, c.phone
         HAVING MAX(a.appointment_time) < NOW() - INTERVAL '30 days' OR MAX(a.appointment_time) IS NULL`,
        [establishmentId]
      );

      const revenueToday = parseFloat(revTodayRes.rows[0]?.total || '0');
      const countToday = parseInt(revTodayRes.rows[0]?.count || '0', 10);
      const revenueMonth = parseFloat(revMonthRes.rows[0]?.total || '0');
      const countMonth = parseInt(revMonthRes.rows[0]?.count || '0', 10);

      // Occupancy Rate estimate (assuming 16 slots per barber/day)
      const totalBarbers = commissionsRes.rows.length || 1;
      const totalCapacityToday = totalBarbers * 16;
      const occupancyRate = Math.min(100, Math.round((countToday / Math.max(1, totalCapacityToday)) * 100));

      return res.json({
        revenueToday,
        countToday,
        revenueMonth,
        countMonth,
        occupancyRate,
        barberCommissions: commissionsRes.rows.map(r => ({
          barberId: r.barber_id,
          barberName: r.barber_name,
          totalServices: parseInt(r.total_services, 10),
          totalRevenue: parseFloat(r.total_revenue),
          commissionEarned: parseFloat(r.commission_earned),
          commissionRate: 50
        })),
        inactiveClientsCount: inactiveClientsRes.rows.length,
        inactiveClients: inactiveClientsRes.rows
      });
    } catch (err) {
      console.error('Executive analytics error:', err);
      return res.status(500).json({ error: 'Erro ao buscar métricas.' });
    }
  }
);

router.post(
  '/establishments/:establishmentId/campaigns/reengage-inactive',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const establishmentId = String(req.params.establishmentId);
    const { customMessage } = req.body || {};

    if (customMessage !== undefined && typeof customMessage !== 'string') {
      return res.status(400).json({ error: 'Mensagem personalizada inválida.' });
    }

    try {
      // Find inactive clients
      const inactiveRes = await pool.query(
        `SELECT c.name, c.phone
         FROM clients c
         LEFT JOIN appointments a ON c.id = a.client_id
         WHERE c.establishment_id = $1
         GROUP BY c.id, c.name, c.phone
         HAVING MAX(a.appointment_time) < NOW() - INTERVAL '30 days' OR MAX(a.appointment_time) IS NULL`,
        [establishmentId]
      );

      const clients = inactiveRes.rows;
      if (clients.length === 0) {
        return res.json({ message: 'Nenhum cliente inativo encontrado.', count: 0 });
      }

      // Responde imediatamente. O loop antigo segurava a requisição por 1 segundo
      // por cliente — com 300 contatos a conexão estourava o timeout do proxy e o
      // usuário via um erro apesar de a campanha estar rodando.
      res.json({
        message: `Campanha de reativação iniciada para ${clients.length} clientes inativos.`,
        count: clients.length,
        estimated_seconds: clients.length,
      });

      void (async () => {
        for (const client of clients) {
          const text = customMessage && customMessage.trim() !== ''
            ? customMessage.replace(/{nome}/g, client.name)
            : `Olá ${client.name}! 💈 Sentimos sua falta na barbearia! Que tal agendar seu corte para esta semana? É só responder essa mensagem ou agendar pelo nosso link!`;

          try {
            await sendManualMessage(establishmentId, client.phone, text);
          } catch (sendErr) {
            console.error(`[ReengageCampaign] Falha ao enviar para ${client.phone}:`, sendErr);
          }
          await new Promise((r) => setTimeout(r, 1000)); // Delay to prevent spam blocks
        }
        console.log(`[ReengageCampaign] Campanha do estabelecimento ${establishmentId} finalizada.`);
      })().catch((err) => console.error('[ReengageCampaign] Erro em background:', err));
    } catch (err) {
      console.error('Re-engagement campaign error:', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Erro ao disparar campanha.' });
      }
    }
  }
);

router.get(
  '/establishments/:establishmentId/barbers/my-today',
  verifyToken,
  checkEstablishmentAccess,
  requireRole(['owner', 'admin', 'barber']),
  async (req: AuthenticatedRequest, res) => {
    const { establishmentId } = req.params;
    const barberId = req.user?.id;

    try {
      const appointmentsRes = await pool.query(
        `SELECT a.id, a.appointment_time, a.status, s.name as service_name, s.price as service_price,
                c.name as client_name, c.phone as client_phone
         FROM appointments a
         JOIN services s ON a.service_id = s.id
         JOIN clients c ON a.client_id = c.id
         WHERE a.establishment_id = $1 AND a.barber_id = $2
           AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE
         ORDER BY a.appointment_time ASC`,
        [establishmentId, barberId]
      );

      const totalEarningsToday = appointmentsRes.rows
        .filter(r => r.status !== 'cancelled')
        .reduce((acc, r) => acc + (parseFloat(r.service_price) * 0.50), 0);

      return res.json({
        appointments: appointmentsRes.rows,
        totalEarningsToday,
        totalServicesToday: appointmentsRes.rows.filter(r => r.status !== 'cancelled').length
      });
    } catch (err) {
      console.error('Barber today schedule error:', err);
      return res.status(500).json({ error: 'Erro ao buscar agenda do barbeiro.' });
    }
  }
);

// Super Admin user and establishment management
router.get('/admin/users', verifyToken, requireRole(['admin']), listAllUsers);
router.post('/admin/users/:userId/change-password', verifyToken, requireRole(['admin']), changeUserPassword);
router.post('/admin/establishments', verifyToken, requireRole(['admin']), registerOwner);

// Comunicado global para todos os proprietários (Super Admin).
//
// O painel chamava `POST /api/whatsapp/send`, uma rota que nunca existiu — e ainda
// passava um objeto onde `apiRequest` espera o verbo HTTP. O `catch` vazio dentro
// do laço engolia o 404, então o admin via "enviado para 0 proprietários" sem
// qualquer pista do motivo. Agora há um endpoint real, com um único request.
router.post(
  '/admin/broadcast',
  verifyToken,
  requireRole(['admin']),
  async (req: AuthenticatedRequest, res) => {
    const { message } = req.body || {};

    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'A mensagem do comunicado é obrigatória.' });
    }

    if (message.length > 4000) {
      return res.status(400).json({ error: 'A mensagem excede o limite de 4000 caracteres.' });
    }

    try {
      const ownersRes = await pool.query(
        `SELECT u.phone, u.establishment_id
         FROM users u
         JOIN establishments e ON e.id = u.establishment_id
         WHERE u.role = 'owner' AND u.is_active = TRUE
           AND e.is_active = TRUE
           AND u.phone IS NOT NULL AND u.phone <> ''`
      );

      const owners = ownersRes.rows;
      if (owners.length === 0) {
        return res.json({ message: 'Nenhum proprietário elegível encontrado.', count: 0, total: 0 });
      }

      const text = `📢 *AVISO DA PLATAFORMA BARBERHUB*\n\n${message.trim()}\n\n_Atenciosamente, Equipe BarberHub_`;

      let queued = 0;
      for (const owner of owners) {
        // Enviado pela sessão master do sistema para não depender de cada
        // barbearia ter o próprio WhatsApp conectado.
        const ok = await sendOrchestratedMessage(SYSTEM_ESTABLISHMENT_ID, owner.phone, text);
        if (ok) queued++;
      }

      return res.json({
        message: `Comunicado enfileirado para ${queued} de ${owners.length} proprietários.`,
        count: queued,
        total: owners.length,
      });
    } catch (err) {
      console.error('Admin broadcast error:', err);
      return res.status(500).json({ error: 'Erro ao enviar comunicado.' });
    }
  }
);

// Super Admin WhatsApp sessions management
router.get('/admin/whatsapp-sessions', verifyToken, requireRole(['admin']), listWhatsAppSessions);
router.post('/admin/whatsapp-sessions/:establishmentId/logout', verifyToken, requireRole(['admin']), logoutWhatsAppSession);
router.post('/admin/whatsapp-sessions/:establishmentId/start', verifyToken, requireRole(['admin']), startWhatsAppSessionAdmin);

// Super Admin Establishment Commission configuration
router.put('/admin/establishments/:establishmentId/commission', verifyToken, requireRole(['admin']), updateEstablishmentCommission);
router.put('/admin/establishments/:establishmentId/status', verifyToken, requireRole(['admin']), updateEstablishmentStatus);
router.put('/admin/establishments/:establishmentId/license', verifyToken, requireRole(['admin']), updateEstablishmentLicense);
router.delete('/admin/establishments/:establishmentId', verifyToken, requireRole(['admin']), deleteEstablishment);

// Establishment Metrics (Owner, Admin or Barber)
router.get('/establishments/:establishmentId/metrics', verifyToken, checkEstablishmentAccess, getEstablishmentMetrics);

// Global metrics for Super Admin
router.get('/admin/metrics', verifyToken, requireRole(['admin']), getGlobalMetrics);

// ==========================================
// CLIENT PORTAL ROUTES
// ==========================================
// `authClient` emite um token de 30 dias só com o telefone; sem rate limit era
// possível varrer números sequencialmente e coletar tokens em massa.
router.post('/client/auth', authRateLimiter, authClient);
router.get('/client/dashboard', verifyToken, requireRole(['client']), getClientData);
router.get('/client/establishments/:establishmentId/details', verifyToken, requireRole(['client']), getEstablishmentDetails);
router.post('/client/bookings', verifyToken, requireRole(['client']), apiRateLimiter, clientBookAppointment);
router.put('/client/bookings/:bookingId/reschedule', verifyToken, requireRole(['client']), apiRateLimiter, rescheduleBooking);
router.post('/client/bookings/:bookingId/cancel', verifyToken, requireRole(['client']), cancelClientBooking);
router.post('/client/bookings/cancel-all', verifyToken, requireRole(['client']), cancelAllClientBookings);
router.post('/client/feedbacks', verifyToken, requireRole(['client']), createFeedback);
router.post('/client/subscribe', verifyToken, requireRole(['client']), apiRateLimiter, subscribeToPlan);

export default router;
