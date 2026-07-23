import { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/db';
import { AuthenticatedRequest } from '../middleware/auth';
import { sendOrchestratedMessage } from '../services/whatsappManager';
import { JWT_SECRET, JWT_STAFF_EXPIRATION } from '../config/jwt';
import { normalizePhone } from '../utils/phone';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// Hash descartável ("não-é-uma-senha", 12 rounds) usado só para igualar o tempo
// de resposta quando o e-mail informado não existe.
const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.wqbZbrJLZoRfmwqBqEuDPWXvhcNPqUC';

// Alfabeto sem caracteres ambíguos (0/O, 1/l/I) — a senha é ditada via WhatsApp.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Senha temporária com CSPRNG. `Math.random()` não é criptográfico: seu estado
 * interno é recuperável a partir de poucas saídas, o que permitiria prever as
 * senhas emitidas para outros estabelecimentos.
 */
const generateTempPassword = (length = 14): string => {
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    // Rejeita valores que enviesariam a distribuição módulo.
    const max = 256 - (256 % TEMP_PASSWORD_ALPHABET.length);
    if (bytes[i] >= max) continue;
    out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return out.length === length ? out : generateTempPassword(length);
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
      // Gasta o mesmo tempo de um bcrypt real para não vazar, por diferença de
      // latência, se o e-mail existe na base (user enumeration por timing).
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    // A senha é verificada ANTES de qualquer checagem de status. Responder
    // "estabelecimento suspenso" a quem não sabe a senha entrega ao atacante a
    // confirmação de que o e-mail existe e qual o estado da conta.
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

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
      { expiresIn: JWT_STAFF_EXPIRATION }
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

  // Validação de formato (allowlist) antes de tocar no banco.
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }

  // O slug entra em URLs públicas: apenas minúsculas, dígitos e hífen.
  if (typeof establishment_slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(establishment_slug)) {
    return res.status(400).json({
      error: 'O identificador da barbearia deve ter de 2 a 63 caracteres, usando apenas letras minúsculas, números e hífen.',
    });
  }

  if (String(name).trim().length < 2 || String(establishment_name).trim().length < 2) {
    return res.status(400).json({ error: 'Nome do responsável e da barbearia são obrigatórios.' });
  }

  // Format phone number to canonical representation (55 + DDD + assinante)
  const cleanPhone = normalizePhone(phone);
  if (cleanPhone.length < 12) {
    return res.status(400).json({ error: 'Telefone inválido. Informe DDD + número.' });
  }

  const tempPassword = generateTempPassword();

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

    // Insert new establishment with default colors and standard chatbot flow preset
    const defaultBotFlow = {
      nodes: [
        { id: 'start', type: 'start', title: 'Início', x: 50, y: 250 },
        { id: 'welcome', type: 'message', title: 'Boas-Vindas', x: 350, y: 250, text: 'Olá! Seja bem-vindo à Barbearia.' },
        { id: 'check_intent', type: 'condition', title: 'Verificar Opção', x: 690, y: 250, options: [
          { key: '1', label: 'Agendar', target: 'select_barber' },
          { key: '2', label: 'Contato', target: 'other_help' }
        ]},
        { id: 'select_barber', type: 'action', actionType: 'select_barber', title: '1. Escolher Barbeiro', x: 1050, y: 80, target: 'select_date' },
        { id: 'select_date', type: 'action', actionType: 'select_date', title: '2. Escolher Data', x: 1410, y: 80, target: 'select_slot' },
        { id: 'select_slot', type: 'action', actionType: 'select_slot', title: '3. Escolher Horário', x: 1770, y: 250, target: 'confirmed' },
        { id: 'confirmed', type: 'message', title: 'Confirmação', x: 2130, y: 250, text: '✅ *Agendamento Confirmado!*\n\n*Profissional:* {barbeiro}\n*Horário:* {horario}\n*Data:* {data}\n\nSeu agendamento foi registrado com sucesso! 💈', target: 'offer_plan' },
        { id: 'offer_plan', type: 'action', actionType: 'offer_plan', title: '4. Clube Assinatura', x: 2490, y: 250, target: 'end' },
        { id: 'end', type: 'end', title: 'Fim', x: 2850, y: 250 },
        { id: 'other_help', type: 'message', title: 'Informações', x: 1050, y: 420, text: '💈 Nossos horários de atendimento são das {abertura} às {fechamento}.\n📞 Se precisar falar com um atendente, nos ligue no (11) 99999-8888. Obrigado! 👍', target: 'end' }
      ],
      edges: [
        { id: 'e_start_welcome', source: 'start', target: 'welcome' },
        { id: 'e_welcome_check_intent', source: 'welcome', target: 'check_intent' },
        { id: 'e_check_intent_1_select_barber', source: 'check_intent', sourceHandle: '1', target: 'select_barber' },
        { id: 'e_check_intent_2_other_help', source: 'check_intent', sourceHandle: '2', target: 'other_help' },
        { id: 'e_select_barber_select_date', source: 'select_barber', target: 'select_date' },
        { id: 'e_select_date_select_slot', source: 'select_date', target: 'select_slot' },
        { id: 'e_select_slot_confirmed', source: 'select_slot', target: 'confirmed' },
        { id: 'e_confirmed_offer_plan', source: 'confirmed', target: 'offer_plan' },
        { id: 'e_offer_plan_end', source: 'offer_plan', target: 'end' },
        { id: 'e_other_help_end', source: 'other_help', target: 'end' }
      ]
    };

    const estResult = await client.query(
      `INSERT INTO establishments (name, slug, primary_color, secondary_color, background_color, text_color, bot_flow) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [establishment_name, establishment_slug, '#e2a857', '#1e1e24', '#0f0f11', '#f3f4f6', JSON.stringify(defaultBotFlow)]
    );
    const establishmentId = estResult.rows[0].id;

    // Hash temporary password
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
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

    // A senha temporária volta na resposta porque o super admin precisa repassá-la
    // manualmente caso a sessão WhatsApp do sistema esteja fora do ar. A rota já
    // exige role 'admin', que de todo modo pode redefinir a senha de qualquer usuário.
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

  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `A nova senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.` });
  }

  if (newPassword.length > 128) {
    return res.status(400).json({ error: 'A nova senha é longa demais (máximo de 128 caracteres).' });
  }

  try {
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
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
