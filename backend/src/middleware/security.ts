import { Request, Response, NextFunction } from 'express';
import { filterXSS } from 'xss';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

// XSS Sanitization Middleware
// Recursively sanitizes string inputs to prevent Reflected XSS

// Chaves que, se copiadas para um objeto, alteram o protótipo global do processo
// (prototype pollution). São descartadas antes de qualquer atribuição.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Limite de profundidade: sem ele um JSON com milhares de níveis aninhados
// estoura a pilha e derruba o processo (DoS com um único request de poucos KB).
const MAX_DEPTH = 20;

const sanitizeObject = (obj: any, depth = 0): any => {
  if (depth > MAX_DEPTH) return null;

  if (typeof obj !== 'object' || obj === null) {
    if (typeof obj === 'string') {
      return filterXSS(obj.trim());
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      delete obj[key];
      continue;
    }
    obj[key] = sanitizeObject(obj[key], depth + 1);
  }
  return obj;
};

export const xssSanitizer = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    for (const key in req.query) {
      if (Object.prototype.hasOwnProperty.call(req.query, key)) {
        req.query[key] = sanitizeObject(req.query[key]) as any;
      }
    }
  }
  if (req.params) {
    for (const key in req.params) {
      if (Object.prototype.hasOwnProperty.call(req.params, key)) {
        req.params[key] = sanitizeObject(req.params[key]) as any;
      }
    }
  }
  next();
};

// Rate Limiting Middlewares
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 authentication attempts per window
  message: { error: 'Too many authentication attempts from this IP. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 API requests per window
  message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit dedicado ao webhook interno (gateway do WhatsApp -> backend).
export const internalWebhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { error: 'Too many webhook events.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Autenticação máquina-a-máquina para rotas internas (webhook do gateway).
 *
 * Usa `timingSafeEqual` porque comparar segredos com `===` vaza, pelo tempo de
 * execução, quantos bytes iniciais o atacante já acertou.
 */
export const internalWebhookAuth = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.INTERNAL_API_KEY;

  // Fail-secure: sem segredo configurado a rota fica fechada, nunca aberta.
  if (!expected || expected.length < 16) {
    console.error('[SECURITY] INTERNAL_API_KEY ausente ou fraca. Rota interna bloqueada.');
    return res.status(503).json({ error: 'Internal endpoint not configured.' });
  }

  const provided = req.headers['x-internal-key'];
  if (typeof provided !== 'string') {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);

  // timingSafeEqual exige buffers do mesmo tamanho; comparamos hashes de tamanho
  // fixo para não vazar o comprimento do segredo.
  const expectedHash = crypto.createHash('sha256').update(expectedBuf).digest();
  const providedHash = crypto.createHash('sha256').update(providedBuf).digest();

  if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  next();
};

/**
 * CSRF Double Submit Validation Middleware.
 *
 * A API é 100% stateless via `Authorization: Bearer` — o navegador não anexa esse
 * header automaticamente, então requisições cross-site não conseguem autenticar e
 * CSRF clássico não se aplica. A verificação abaixo existe como rede de proteção
 * caso autenticação por cookie seja introduzida no futuro.
 *
 * Correção: a versão anterior lia `req.cookies`, mas o projeto não usa
 * `cookie-parser` — o valor era sempre `undefined`, o que na prática rejeitava
 * qualquer requisição sem Bearer em produção. Agora lemos o header `Cookie` cru.
 */
export const csrfCheck = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  // If the request doesn't modify state, skip CSRF check
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Exclude public auth and booking endpoints where no session exists yet
  if (
    req.path.includes('/auth/login') ||
    req.path.includes('/auth/register-owner') ||
    req.path.includes('/public-bookings') ||
    req.path.includes('/client/auth') ||
    req.path.includes('/bot/webhook-event')
  ) {
    return next();
  }

  // If using Authorization headers (stateless JWT), CSRF is not possible.
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  const csrfCookie = parseCookie(req.headers.cookie, '_csrf');
  const csrfHeader = req.headers['x-csrf-token'];

  if (
    !csrfCookie ||
    typeof csrfHeader !== 'string' ||
    csrfCookie.length !== csrfHeader.length ||
    !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader))
  ) {
    return res.status(403).json({ error: 'CSRF token mismatch or missing. Action forbidden.' });
  }

  next();
};

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}
