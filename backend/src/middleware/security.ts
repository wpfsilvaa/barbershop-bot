import { Request, Response, NextFunction } from 'express';
import { filterXSS } from 'xss';
import rateLimit from 'express-rate-limit';

// XSS Sanitization Middleware
// Recursively sanitizes string inputs to prevent Reflected XSS
const sanitizeObject = (obj: any): any => {
  if (typeof obj !== 'object' || obj === null) {
    if (typeof obj === 'string') {
      return filterXSS(obj.trim());
    }
    return obj;
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      obj[key] = sanitizeObject(obj[key]);
    }
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

// CSRF Double Submit Validation Middleware
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
    req.path.includes('/public-bookings')
  ) {
    return next();
  }

  // If using Authorization headers (stateless JWT), CSRF is not possible.
  // We check if Authorization header exists. If it exists, we let it pass.
  // Otherwise (e.g. cookie-based auth), we check for the CSRF token.
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  const csrfCookie = req.cookies?.['_csrf'];
  const csrfHeader = req.headers['x-csrf-token'];

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ error: 'CSRF token mismatch or missing. Action forbidden.' });
  }

  next();
};
