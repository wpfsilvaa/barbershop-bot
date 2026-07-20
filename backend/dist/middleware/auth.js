"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkEstablishmentAccess = exports.requireRole = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
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
const checkEstablishmentAccess = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    // System admin bypasses checks
    if (req.user.role === 'admin') {
        return next();
    }
    const userEstId = req.user.establishment_id;
    // Extract target establishment ID from params, query, or body
    const targetEstId = req.params.establishmentId || req.query.establishmentId || req.body.establishment_id;
    if (!userEstId) {
        return res.status(403).json({ error: 'User does not belong to any establishment.' });
    }
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
