import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

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
  const token = authHeader && authHeader.split(' ')[1];

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
export const checkEstablishmentAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
  } else {
    req.query.establishment_id = userEstId;
  }

  next();
};
