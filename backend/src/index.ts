import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import router from './routes';
import { xssSanitizer, csrfCheck } from './middleware/security';
import { initializeAllWhatsAppSessions } from './services/whatsappManager';
import { startReminderScheduler } from './services/reminderService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middlewares
const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
  app.use(helmet({ contentSecurityPolicy: false }));
} else {
  app.use(helmet()); 
}

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.CORS_ORIGIN
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      if (isDev) {
        return callback(null, true); 
      }
      if (!origin) return callback(null, true);
      const isLocal = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
      if (isLocal || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Custom Security Middlewares (XSS Prevention & CSRF Double Submit Validation)
app.use(xssSanitizer);
app.use(csrfCheck);

// API Routes prefix
app.use('/api', router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected error occurred on the server.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start WhatsApp Multitenant Sessions Orchestration
  initializeAllWhatsAppSessions().catch((err) => {
    console.error('Failed to initialize WhatsApp multitenant sessions:', err);
  });

  // Start plan-based appointment reminders checker
  startReminderScheduler();
});
