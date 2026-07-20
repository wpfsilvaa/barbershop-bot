import { Router } from 'express';
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
  createEstablishmentClient
} from './controllers/crmController';
import { verifyToken, requireRole, checkEstablishmentAccess, AuthenticatedRequest } from './middleware/auth';
import { authRateLimiter, apiRateLimiter } from './middleware/security';
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
  deleteEstablishment
} from './controllers/adminController';

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
        'SELECT status, qr_code FROM whatsapp_sessions WHERE establishment_id = $1',
        [establishmentId]
      );

      if (result.rows.length === 0) {
        // If not registered yet, start connection asynchronously
        startWhatsAppSession(String(establishmentId)).catch(e => console.error(e));
        return res.json({ status: 'connecting', qr: null });
      }

      const { status, qr_code } = result.rows[0];

      if (status === 'disconnected') {
        startWhatsAppSession(String(establishmentId)).catch(e => console.error(e));
        return res.json({ status: 'connecting', qr: null });
      }

      return res.json({ status, qr: qr_code });
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
async function checkBarberChatAccess(barberId: string, establishmentId: string, targetPhone: string): Promise<boolean> {
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

  const targetPhoneClean = targetPhone.replace(/\D/g, '');
  return appointmentsToday.rows.some(row => {
    const phoneClean = row.phone.replace(/\D/g, '');
    return targetPhoneClean.endsWith(phoneClean.slice(-9));
  });
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

        const clientPhones = appointmentsToday.rows.map(row => row.phone.replace(/\D/g, ''));

        chats = chats.filter(chat => {
          const chatPhoneClean = chat.phone.replace(/\D/g, '');
          return clientPhones.some(phone => {
            return chatPhoneClean.endsWith(phone.slice(-9));
          });
        });
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

      const realJid = await sendManualMessage(String(establishmentId), String(phone), formattedMessage);
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

      const { message } = req.body;
      if (message && typeof message === 'string' && message.trim() !== '') {
        const roleLabel = req.user.role === 'owner' 
          ? 'Proprietário' 
          : req.user.role === 'admin' 
            ? 'Administrador' 
            : 'Barbeiro';
        
        const formattedMessage = `*[${roleLabel}] ${req.user.name}:*\n${message.trim()}`;
        await sendManualMessage(String(establishmentId), String(phone), formattedMessage);
      }

      terminateChatSession(String(establishmentId), String(phone));
      return res.json({ message: 'Chat session terminated successfully.' });
    } catch (err) {
      console.error('Terminate bot chat error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ==========================================
// SUPER ADMIN & METRICS ROUTES
// ==========================================

// Super Admin user and establishment management
router.get('/admin/users', verifyToken, requireRole(['admin']), listAllUsers);
router.post('/admin/users/:userId/change-password', verifyToken, requireRole(['admin']), changeUserPassword);
router.post('/admin/establishments', verifyToken, requireRole(['admin']), registerOwner);

// Super Admin WhatsApp sessions management
router.get('/admin/whatsapp-sessions', verifyToken, requireRole(['admin']), listWhatsAppSessions);
router.post('/admin/whatsapp-sessions/:establishmentId/logout', verifyToken, requireRole(['admin']), logoutWhatsAppSession);

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
router.post('/client/auth', authClient);
router.get('/client/dashboard', verifyToken, requireRole(['client']), getClientData);
router.get('/client/establishments/:establishmentId/details', verifyToken, requireRole(['client']), getEstablishmentDetails);
router.post('/client/bookings', verifyToken, requireRole(['client']), clientBookAppointment);
router.put('/client/bookings/:bookingId/reschedule', verifyToken, requireRole(['client']), rescheduleBooking);
router.post('/client/bookings/:bookingId/cancel', verifyToken, requireRole(['client']), cancelClientBooking);
router.post('/client/bookings/cancel-all', verifyToken, requireRole(['client']), cancelAllClientBookings);
router.post('/client/feedbacks', verifyToken, requireRole(['client']), createFeedback);
router.post('/client/subscribe', verifyToken, requireRole(['client']), subscribeToPlan);

export default router;
