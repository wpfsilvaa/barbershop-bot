"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const routes_1 = __importDefault(require("./routes"));
const security_1 = require("./middleware/security");
const whatsappManager_1 = require("./services/whatsappManager");
const reminderService_1 = require("./services/reminderService");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Security Middlewares
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
    app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
}
else {
    app.use((0, helmet_1.default)());
}
const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    process.env.CORS_ORIGIN
].filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (isDev) {
            return callback(null, true);
        }
        if (!origin)
            return callback(null, true);
        const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
        if (isLocal || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Custom Security Middlewares (XSS Prevention & CSRF Double Submit Validation)
app.use(security_1.xssSanitizer);
app.use(security_1.csrfCheck);
// API Routes prefix
app.use('/api', routes_1.default);
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'An unexpected error occurred on the server.' });
});
// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Start WhatsApp Multitenant Sessions Orchestration
    (0, whatsappManager_1.initializeAllWhatsAppSessions)().catch((err) => {
        console.error('Failed to initialize WhatsApp multitenant sessions:', err);
    });
    // Start plan-based appointment reminders checker
    (0, reminderService_1.startReminderScheduler)();
});
