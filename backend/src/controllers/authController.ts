import { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { AuthenticatedRequest } from '../middleware/auth';
import { sendOrchestratedMessage } from '../services/whatsappManager';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

const formatPhone = (phone: string) => {
  let clean = phone.replace(/\D/g, '').trim();
  if (clean.startsWith('55')) {
    clean = clean.substring(2);
  }
  if (clean.length === 11 && clean[2] === '9') {
    clean = clean.substring(0, 2) + clean.substring(3);
  }
  return '55' + clean;
};

// Login User
export const login = async (req: AuthenticatedRequest, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // Parameterized SQL query to prevent SQL Injection, joining establishments to get the slug
    const result = await pool.query(
      `SELECT u.*, e.slug as establishment_slug, e.is_active as establishment_active,
              e.expires_at as establishment_expires_at 
       FROM users u 
       LEFT JOIN establishments e ON u.establishment_id = e.id 
       WHERE u.email = $1`, 
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Acesso revogado. Entre em contato com o administrador.' });
    }

    if (user.establishment_id) {
      if (user.establishment_active === false) {
        return res.status(403).json({ error: 'Acesso revogado. O estabelecimento associado está suspenso.' });
      }
      
      if (user.establishment_expires_at) {
        const expiresAt = new Date(user.establishment_expires_at);
        if (expiresAt < new Date()) {
          return res.status(403).json({ error: 'Acesso expirado. Seu período de testes ou assinatura chegou ao fim.' });
        }
      }
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate stateless JWT
    const token = jwt.sign(
      {
        id: user.id,
        establishment_id: user.establishment_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        establishment_id: user.establishment_id,
        establishment_slug: user.establishment_slug,
        requirePasswordChange: user.require_password_change,
        establishment_expires_at: user.establishment_expires_at,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Get current authenticated user details
export const getMe = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.establishment_id, u.is_active, 
              e.slug as establishment_slug, e.is_active as establishment_active,
              e.expires_at as establishment_expires_at 
       FROM users u 
       LEFT JOIN establishments e ON u.establishment_id = e.id 
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Acesso revogado. Entre em contato com o administrador.' });
    }

    if (user.establishment_id) {
      if (user.establishment_active === false) {
        return res.status(403).json({ error: 'Acesso revogado. O estabelecimento associado está suspenso.' });
      }
      
      if (user.establishment_expires_at) {
        const expiresAt = new Date(user.establishment_expires_at);
        if (expiresAt < new Date()) {
          return res.status(403).json({ error: 'Acesso expirado. Seu período de testes ou assinatura chegou ao fim.' });
        }
      }
    }

    return res.json(user);
  } catch (error) {
    console.error('GetMe error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Register a New Establishment and Owner (Super Admin protected creation)
export const registerOwner = async (req: AuthenticatedRequest, res: Response) => {
  const { name, email, phone, establishment_name, establishment_slug } = req.body;

  if (!name || !email || !phone || !establishment_name || !establishment_slug) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  // Format phone number to clean representation (55 + DDD + 8 digits)
  const cleanPhone = formatPhone(phone);

  // Generate a random temporary password (e.g. "x8f9a2bC")
  const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).substring(2, 4).toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if email already exists
    const userCheck = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already registered.' });
    }

    // Check if slug already exists
    const slugCheck = await client.query('SELECT id FROM establishments WHERE slug = $1', [establishment_slug]);
    if (slugCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Establishment URL slug already in use.' });
    }

    // Insert new establishment with default colors
    const estResult = await client.query(
      `INSERT INTO establishments (name, slug, primary_color, secondary_color, background_color, text_color) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [establishment_name, establishment_slug, '#e2a857', '#1e1e24', '#0f0f11', '#f3f4f6']
    );
    const establishmentId = estResult.rows[0].id;

    // Hash temporary password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);

    // Insert user with owner role, phone and require_password_change = true
    const userResult = await client.query(
      `INSERT INTO users (establishment_id, name, email, password_hash, role, phone, require_password_change) 
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id, name, email, role, phone, establishment_id`,
      [establishmentId, name, email, passwordHash, 'owner', cleanPhone]
    );

    await client.query('COMMIT');

    const registeredUser = {
      ...userResult.rows[0],
      establishment_slug
    };

    // Send credentials notification via Master System WhatsApp Session asynchronously
    const messageText = `Olá, *${name}*! Sua barbearia *${establishment_name}* foi cadastrada com sucesso no BarberHub! 💈\n\nEstes são os seus dados de acesso:\n📧 *E-mail:* ${email}\n🔑 *Senha Temporária:* ${tempPassword}\n\nPara acessar seu painel e configurar sua barbearia, faça login em sua conta. No primeiro acesso, será solicitada a troca da sua senha por questões de segurança.\n\nSeja bem-vindo ao ecossistema! 🚀`;

    sendOrchestratedMessage('00000000-0000-0000-0000-000000000000', cleanPhone, messageText).catch((err) => {
      console.error('[WhatsAppNotify] Failed to send credentials to owner:', err);
    });

    return res.status(201).json({
      message: 'Establishment and Owner registered successfully.',
      user: registeredUser,
      tempPassword,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Register owner error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
};

// Change Temporary Password on First Login
export const changeTempPassword = async (req: AuthenticatedRequest, res: Response) => {
  const { newPassword } = req.body;
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    await pool.query(
      'UPDATE users SET password_hash = $1, require_password_change = FALSE WHERE id = $2',
      [hash, req.user.id]
    );

    return res.json({ message: 'Password updated successfully. Access granted.' });
  } catch (error) {
    console.error('Change temp password error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
