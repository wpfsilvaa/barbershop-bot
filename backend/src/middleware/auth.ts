import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { JWT_SECRET } from '../config/jwt';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    establishment_id: string | null;
    name: string;
    email?: string;
    phone?: string;
    role: 'admin' | 'owner' | 'barber' | 'client';
  };
}

// Verify JWT Token Middleware
export const verifyToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || (req.query.token as string);

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// Role-Based Authorization Middleware
export const requireRole = (allowedRoles: ('admin' | 'owner' | 'barber' | 'client')[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permission denied. Insufficient privileges.' });
    }

    next();
  };
};

// IDOR Prevention Middleware: Ensures users can only query/edit resources inside their own establishment
export const checkEstablishmentAccess = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
    const estRes = await pool.query(
      'SELECT is_active, expires_at FROM establishments WHERE id = $1',
      [userEstId]
    );

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
  } catch (err) {
    console.error('Error in checkEstablishmentAccess middleware validation:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }

  // Extract target establishment ID from params, query, or body
  const targetEstId =
    req.params.establishmentId || req.query.establishmentId || (req.body && req.body.establishment_id);

  if (targetEstId && String(targetEstId) !== String(userEstId)) {
    return res.status(403).json({ error: 'Access denied. You cannot modify resources of another establishment (IDOR Block).' });
  }

  // Inject establishment_id into request body/query to enforce safety
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (!req.body || typeof req.body !== 'object') {
      req.body = {};
    }
    req.body.establishment_id = userEstId;
  } else {
    req.query.establishment_id = userEstId;
  }

  next();
};
