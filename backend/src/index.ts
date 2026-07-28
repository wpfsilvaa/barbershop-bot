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

// Necessário para que o express-rate-limit veja o IP real do cliente atrás de um
// proxy reverso. Sem isto todos os requests compartilham o IP do proxy e um único
// atacante consegue esgotar o limite de todo mundo. Configuração restrita a 1 hop
// para que ninguém possa forjar X-Forwarded-For e escapar do rate limit.
app.set('trust proxy', 1);

if (isDev) {
  app.use(helmet({ contentSecurityPolicy: false }));
} else {
  app.use(helmet()); 
}

// CORS_ORIGIN aceita uma lista separada por vírgulas.
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = isDev ? [...devOrigins, ...configuredOrigins] : configuredOrigins;

if (!isDev && allowedOrigins.length === 0) {
  console.error('[SECURITY] CORS_ORIGIN não configurado em produção. Nenhuma origem de navegador será aceita.');
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Requisições sem Origin (curl, health checks, apps nativos) não são
      // cross-site: o navegador é quem envia o header. A API é Bearer-only,
      // então liberar aqui não abre CSRF.
      if (!origin) return callback(null, true);

      // Em produção nunca liberamos "qualquer localhost": isso permitia que uma
      // página maliciosa aberta na máquina de um funcionário conversasse com a
      // API de produção com credentials habilitado.
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (isDev && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+):\d+$/.test(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Internal-Key'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Custom Security Middlewares (XSS Prevention & CSRF Double Submit Validation)
app.use(xssSanitizer);
app.use(csrfCheck);

// Request Logger Middleware
//
// Loga apenas o caminho, nunca a query string: o EventSource do painel envia o JWT
// em `?token=...`, e a versão anterior (`req.url`) gravava esses tokens em texto
// puro no log — quem tivesse acesso aos logs assumia a sessão de qualquer usuário.
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

// API Routes prefix
app.use('/api', router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 handler (antes do error handler, senão rotas inexistentes ficam penduradas)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Body JSON malformado vira 400, não 500.
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed request body.' });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }

  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  // Detalhes ficam só no log do servidor; o cliente recebe mensagem genérica para
  // não expor stack traces, caminhos internos ou estrutura do banco.
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected error occurred on the server.' });
});

// Sem estes handlers, uma promise rejeitada em qualquer worker derruba o processo
// silenciosamente (comportamento padrão do Node desde a v15).
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

import http from 'http';
import { initializeWebSocketServer } from './services/wsServer';
import { ensureSubscriber } from './services/chatEvents';

const server = http.createServer(app);

// Start Server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize WebSocket server & Redis subscriber
  initializeWebSocketServer(server);
  ensureSubscriber();
  
  // Start WhatsApp Multitenant Sessions Orchestration
  initializeAllWhatsAppSessions().catch((err) => {
    console.error('Failed to initialize WhatsApp multitenant sessions:', err);
  });

  // Start plan-based appointment reminders checker
  startReminderScheduler();
});
