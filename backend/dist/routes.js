"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("./config/db"));
const authController_1 = require("./controllers/authController");
const barberController_1 = require("./controllers/barberController");
const establishmentController_1 = require("./controllers/establishmentController");
const serviceController_1 = require("./controllers/serviceController");
const bookingController_1 = require("./controllers/bookingController");
const planController_1 = require("./controllers/planController");
const auth_1 = require("./middleware/auth");
const security_1 = require("./middleware/security");
const whatsappManager_1 = require("./services/whatsappManager");
const adminController_1 = require("./controllers/adminController");
const clientPortalController_1 = require("./controllers/clientPortalController");
const router = (0, express_1.Router)();
// ==========================================
// PUBLIC ROUTES
// ==========================================
// Auth
router.post('/auth/login', security_1.authRateLimiter, authController_1.login);
// Public list of all establishments (Landing Page)
router.get('/establishments', security_1.apiRateLimiter, establishmentController_1.listEstablishments);
// Public list of active services for an establishment (for Web Booking)
router.get('/establishments/:establishmentId/public-services', security_1.apiRateLimiter, serviceController_1.listPublicServices);
// Public list of active services assigned to a barber (for Web Booking)
router.get('/establishments/:establishmentId/barbers/:barberId/services', security_1.apiRateLimiter, serviceController_1.listBarberServices);
// Public Establishment Info (for styling and dynamic palette loading before login)
router.get('/establishments/slug/:slug', security_1.apiRateLimiter, establishmentController_1.getEstablishmentBySlug);
// Public Barber List (for Web App)
router.get('/establishments/:establishmentId/public-barbers', security_1.apiRateLimiter, barberController_1.listPublicBarbers);
// Public Booking helper: get available slots
router.get('/establishments/:establishmentId/barbers/:barberId/available-slots', security_1.apiRateLimiter, bookingController_1.getAvailableSlots);
// Public Booking creation (for Web App)
router.post('/establishments/:establishmentId/public-bookings', security_1.apiRateLimiter, bookingController_1.createPublicAppointment);
// ==========================================
// PROTECTED ROUTES (JWT REQUIRED)
// ==========================================
// Load session details
router.get('/auth/me', auth_1.verifyToken, authController_1.getMe);
router.post('/auth/change-temp-password', auth_1.verifyToken, authController_1.changeTempPassword);
// Establishment configurations
router.get('/establishments/:establishmentId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, establishmentController_1.getEstablishment);
router.put('/establishments/:establishmentId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), establishmentController_1.updateEstablishment);
// Barbers Management
router.get('/establishments/:establishmentId/barbers', auth_1.verifyToken, auth_1.checkEstablishmentAccess, barberController_1.listBarbers);
router.post('/establishments/:establishmentId/barbers', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), barberController_1.createBarber);
router.put('/establishments/:establishmentId/barbers/:barberId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), barberController_1.updateBarber);
router.delete('/establishments/:establishmentId/barbers/:barberId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), barberController_1.deleteBarber);
// Services Management
router.get('/establishments/:establishmentId/services', auth_1.verifyToken, auth_1.checkEstablishmentAccess, serviceController_1.listServices);
router.post('/establishments/:establishmentId/services', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), serviceController_1.createService);
router.put('/establishments/:establishmentId/services/:serviceId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), serviceController_1.updateService);
router.delete('/establishments/:establishmentId/services/:serviceId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), serviceController_1.deleteService);
router.post('/establishments/:establishmentId/barbers/:barberId/services', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin', 'barber']), serviceController_1.assignBarberServices);
// Appointments Management
router.get('/establishments/:establishmentId/bookings', auth_1.verifyToken, auth_1.checkEstablishmentAccess, bookingController_1.listAppointments);
router.post('/establishments/:establishmentId/bookings', auth_1.verifyToken, auth_1.checkEstablishmentAccess, bookingController_1.createAppointment);
router.put('/establishments/:establishmentId/bookings/:bookingId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, bookingController_1.updateAppointment);
router.delete('/establishments/:establishmentId/bookings/:bookingId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, bookingController_1.cancelAppointment);
router.post('/establishments/:establishmentId/bookings/:bookingId/complete', auth_1.verifyToken, auth_1.checkEstablishmentAccess, bookingController_1.completeAppointment);
// Recurring Plans Management
router.get('/establishments/:establishmentId/plans', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), planController_1.listPlans);
router.post('/establishments/:establishmentId/plans', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), planController_1.createOrUpdatePlan);
router.delete('/establishments/:establishmentId/plans/:planId', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), planController_1.deletePlan);
// WhatsApp Multi-Tenant Connection Manager Routes
router.get('/establishments/:establishmentId/bot/status', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query('SELECT status, qr_code FROM whatsapp_sessions WHERE establishment_id = $1', [establishmentId]);
        if (result.rows.length === 0) {
            // If not registered yet, start connection asynchronously
            (0, whatsappManager_1.startWhatsAppSession)(String(establishmentId)).catch(e => console.error(e));
            return res.json({ status: 'connecting', qr: null });
        }
        const { status, qr_code } = result.rows[0];
        if (status === 'disconnected') {
            (0, whatsappManager_1.startWhatsAppSession)(String(establishmentId)).catch(e => console.error(e));
            return res.json({ status: 'connecting', qr: null });
        }
        return res.json({ status, qr: qr_code });
    }
    catch (err) {
        console.error('Fetch bot status error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});
router.post('/establishments/:establishmentId/bot/disconnect', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin']), async (req, res) => {
    const { establishmentId } = req.params;
    try {
        await (0, whatsappManager_1.disconnectWhatsAppSession)(String(establishmentId));
        return res.json({ message: 'WhatsApp disconnected successfully.' });
    }
    catch (err) {
        console.error('Disconnect bot error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});
// Helper para verificar se o barbeiro pode acessar um telefone específico baseado nos agendamentos de hoje
async function checkBarberChatAccess(barberId, establishmentId, targetPhone) {
    const appointmentsToday = await db_1.default.query(`SELECT c.phone 
     FROM appointments a
     JOIN clients c ON a.client_id = c.id
     WHERE a.barber_id = $1 
       AND a.establishment_id = $2 
       AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE
       AND a.status != 'cancelled'`, [barberId, establishmentId]);
    const targetPhoneClean = targetPhone.replace(/\D/g, '');
    return appointmentsToday.rows.some(row => {
        const phoneClean = row.phone.replace(/\D/g, '');
        return targetPhoneClean.endsWith(phoneClean.slice(-9));
    });
}
// Active Conversational Sessions Routes
router.get('/establishments/:establishmentId/bot/chats', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin', 'barber']), async (req, res) => {
    const { establishmentId } = req.params;
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    try {
        let chats = await (0, whatsappManager_1.getActiveChats)(String(establishmentId));
        if (req.user.role === 'barber') {
            const barberId = req.user.id;
            const appointmentsToday = await db_1.default.query(`SELECT c.phone 
           FROM appointments a
           JOIN clients c ON a.client_id = c.id
           WHERE a.barber_id = $1 
             AND a.establishment_id = $2 
             AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE
             AND a.status != 'cancelled'`, [barberId, establishmentId]);
            const clientPhones = appointmentsToday.rows.map(row => row.phone.replace(/\D/g, ''));
            chats = chats.filter(chat => {
                const chatPhoneClean = chat.phone.replace(/\D/g, '');
                return clientPhones.some(phone => {
                    return chatPhoneClean.endsWith(phone.slice(-9));
                });
            });
        }
        return res.json(chats);
    }
    catch (err) {
        console.error('Fetch bot chats error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});
router.post('/establishments/:establishmentId/bot/chats/:phone/pause', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin', 'barber']), async (req, res) => {
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
        (0, whatsappManager_1.pauseChatBot)(String(establishmentId), String(phone));
        return res.json({ message: 'Bot paused successfully for this contact.' });
    }
    catch (err) {
        console.error('Pause bot chat error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});
router.post('/establishments/:establishmentId/bot/chats/:phone/resume', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin', 'barber']), async (req, res) => {
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
        (0, whatsappManager_1.resumeChatBot)(String(establishmentId), String(phone));
        return res.json({ message: 'Bot resumed successfully for this contact.' });
    }
    catch (err) {
        console.error('Resume bot chat error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});
router.post('/establishments/:establishmentId/bot/chats/:phone/message', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin', 'barber']), async (req, res) => {
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
        const realJid = await (0, whatsappManager_1.sendManualMessage)(String(establishmentId), String(phone), formattedMessage);
        return res.json({ message: 'Message sent and bot paused.', realJid, formattedMessage });
    }
    catch (err) {
        console.error('Send manual message error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
});
router.delete('/establishments/:establishmentId/bot/chats/:phone', auth_1.verifyToken, auth_1.checkEstablishmentAccess, (0, auth_1.requireRole)(['owner', 'admin', 'barber']), async (req, res) => {
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
            await (0, whatsappManager_1.sendManualMessage)(String(establishmentId), String(phone), formattedMessage);
        }
        (0, whatsappManager_1.terminateChatSession)(String(establishmentId), String(phone));
        return res.json({ message: 'Chat session terminated successfully.' });
    }
    catch (err) {
        console.error('Terminate bot chat error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});
// ==========================================
// SUPER ADMIN & METRICS ROUTES
// ==========================================
// Super Admin user and establishment management
router.get('/admin/users', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), adminController_1.listAllUsers);
router.post('/admin/users/:userId/change-password', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), adminController_1.changeUserPassword);
router.post('/admin/establishments', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), authController_1.registerOwner);
// Super Admin WhatsApp sessions management
router.get('/admin/whatsapp-sessions', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), adminController_1.listWhatsAppSessions);
router.post('/admin/whatsapp-sessions/:establishmentId/logout', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), adminController_1.logoutWhatsAppSession);
// Super Admin Establishment Commission configuration
router.put('/admin/establishments/:establishmentId/commission', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), adminController_1.updateEstablishmentCommission);
router.put('/admin/establishments/:establishmentId/status', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), adminController_1.updateEstablishmentStatus);
// Establishment Metrics (Owner, Admin or Barber)
router.get('/establishments/:establishmentId/metrics', auth_1.verifyToken, auth_1.checkEstablishmentAccess, adminController_1.getEstablishmentMetrics);
// Global metrics for Super Admin
router.get('/admin/metrics', auth_1.verifyToken, (0, auth_1.requireRole)(['admin']), adminController_1.getGlobalMetrics);
// ==========================================
// CLIENT PORTAL ROUTES
// ==========================================
router.post('/client/auth', clientPortalController_1.authClient);
router.get('/client/dashboard', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.getClientData);
router.get('/client/establishments/:establishmentId/details', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.getEstablishmentDetails);
router.post('/client/bookings', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.clientBookAppointment);
router.put('/client/bookings/:bookingId/reschedule', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.rescheduleBooking);
router.post('/client/bookings/:bookingId/cancel', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.cancelClientBooking);
router.post('/client/bookings/cancel-all', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.cancelAllClientBookings);
router.post('/client/feedbacks', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.createFeedback);
router.post('/client/subscribe', auth_1.verifyToken, (0, auth_1.requireRole)(['client']), clientPortalController_1.subscribeToPlan);
exports.default = router;
