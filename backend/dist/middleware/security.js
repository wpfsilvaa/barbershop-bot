"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.csrfCheck = exports.apiRateLimiter = exports.authRateLimiter = exports.xssSanitizer = void 0;
const xss_1 = require("xss");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// XSS Sanitization Middleware
// Recursively sanitizes string inputs to prevent Reflected XSS
const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
        if (typeof obj === 'string') {
            return (0, xss_1.filterXSS)(obj.trim());
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
const xssSanitizer = (req, res, next) => {
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }
    if (req.query) {
        for (const key in req.query) {
            if (Object.prototype.hasOwnProperty.call(req.query, key)) {
                req.query[key] = sanitizeObject(req.query[key]);
            }
        }
    }
    if (req.params) {
        for (const key in req.params) {
            if (Object.prototype.hasOwnProperty.call(req.params, key)) {
                req.params[key] = sanitizeObject(req.params[key]);
            }
        }
    }
    next();
};
exports.xssSanitizer = xssSanitizer;
// Rate Limiting Middlewares
exports.authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 authentication attempts per window
    message: { error: 'Too many authentication attempts from this IP. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
exports.apiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 API requests per window
    message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
// CSRF Double Submit Validation Middleware
const csrfCheck = (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }
    // If the request doesn't modify state, skip CSRF check
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }
    // Exclude public auth and booking endpoints where no session exists yet
    if (req.path.includes('/auth/login') ||
        req.path.includes('/auth/register-owner') ||
        req.path.includes('/public-bookings')) {
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
exports.csrfCheck = csrfCheck;
