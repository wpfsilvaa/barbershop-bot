"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkEstablishmentAccess = exports.requireRole = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = __importDefault(require("../config/db"));
dotenv_1.default.config();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
// Verify JWT Token Middleware
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Access token required.' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
};
exports.verifyToken = verifyToken;
// Role-Based Authorization Middleware
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Permission denied. Insufficient privileges.' });
        }
        next();
    };
};
exports.requireRole = requireRole;
// IDOR Prevention Middleware: Ensures users can only query/edit resources inside their own establishment
const checkEstablishmentAccess = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    // System admin bypasses checks
    if (req.user.role === 'admin') {
        return next();
    }
    const userEstId = req.user.establishment_id;
    if (!userEstId) {
        return res.status(403).json({ error: 'User does not belong to any establishment.' });
    }
    // Check database status and expiration of the establishment on every checkEstablishmentAccess route
    try {
        const estRes = await db_1.default.query('SELECT is_active, expires_at FROM establishments WHERE id = $1', [userEstId]);
        if (estRes.rows.length === 0) {
            return res.status(404).json({ error: 'Establishment not found.' });
        }
        const est = estRes.rows[0];
        if (est.is_active === false) {
            return res.status(403).json({ error: 'Acesso revogado. O estabelecimento associado está suspenso.' });
        }
        if (est.expires_at) {
            const expiresAt = new Date(est.expires_at);
            if (expiresAt < new Date()) {
                return res.status(403).json({ error: 'Acesso expirado. Seu período de testes ou assinatura chegou ao fim.' });
            }
        }
    }
    catch (err) {
        console.error('Error in checkEstablishmentAccess middleware validation:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
    // Extract target establishment ID from params, query, or body
    const targetEstId = req.params.establishmentId || req.query.establishmentId || req.body.establishment_id;
    if (targetEstId && targetEstId !== userEstId) {
        return res.status(403).json({ error: 'Access denied. You cannot modify resources of another establishment (IDOR Block).' });
    }
    // Inject establishment_id into request body/query to enforce safety
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        req.body.establishment_id = userEstId;
    }
    else {
        req.query.establishment_id = userEstId;
    }
    next();
};
exports.checkEstablishmentAccess = checkEstablishmentAccess;
