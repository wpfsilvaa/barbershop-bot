-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables (in order of dependencies)
DROP TABLE IF EXISTS feedbacks;
DROP TABLE IF EXISTS whatsapp_auth_states;
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS client_plans;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS barber_services;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS establishments;

-- Establishments (Barber Shops)
CREATE TABLE establishments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    primary_color VARCHAR(50) DEFAULT '#e2a857',
    secondary_color VARCHAR(50) DEFAULT '#1e1e24',
    background_color VARCHAR(50) DEFAULT '#0f0f11',
    text_color VARCHAR(50) DEFAULT '#f3f4f6',
    opening_time TIME NOT NULL DEFAULT '08:00:00',
    closing_time TIME NOT NULL DEFAULT '19:00:00',
    slot_duration_minutes INT NOT NULL DEFAULT 30,
    commission_percent INT DEFAULT 50,
    logo_url TEXT,
    address TEXT,
    bio TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    promo_delay_min_seconds INT DEFAULT 10,
    promo_delay_max_seconds INT DEFAULT 20,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Customized Bot Message templates (Legacy fallback fields)
    msg_welcome TEXT DEFAULT 'Olá, *{cliente}*! Seja bem-vindo à {estabelecimento}. 💈\n\nGostaria de agendar um horário?\n\n*1* - Sim, por favor\n*2* - Não, obrigado',
    msg_select_barber TEXT DEFAULT 'Excelente! Escolha o profissional que deseja:\n\n{barbeiros}\nDigite o número correspondente:',
    msg_select_date TEXT DEFAULT 'Perfeito! Para qual dia deseja agendar o horário?\n\n{datas}\nDigite o número correspondente:',
    msg_select_slot TEXT DEFAULT 'Estes são os horários disponíveis com *{barbeiro}* para {data}:\n\n{horarios}\nDigite o número correspondente:',
    msg_confirmed TEXT DEFAULT '✅ *Agendamento Confirmado!*\n\n*Profissional:* {barbeiro}\n*Horário:* {horario}\n*Data:* {data}\n\nSeu agendamento foi registrado com sucesso. Te esperamos lá! 💈',
    msg_fallback TEXT DEFAULT 'Opção inválida. Por favor, responda com um dos números correspondentes da lista.',
    
    -- Graphical branching chatbot flow graph JSONB configuration (including Start/End nodes)
    bot_flow JSONB DEFAULT '{
      "nodes": [
        { "id": "start", "type": "start", "title": "Início", "x": 40, "y": 200 },
        { "id": "welcome", "type": "message", "title": "Boas-Vindas", "x": 240, "y": 200, "text": "Olá! Seja bem-vindo à Barbearia." },
        { "id": "check_intent", "type": "condition", "title": "Verificar Opção", "x": 540, "y": 200, "options": [
          { "key": "1", "label": "Agendar", "target": "select_barber" },
          { "key": "2", "label": "Contato", "target": "other_help" }
        ]},
        { "id": "other_help", "type": "message", "title": "Informações", "x": 840, "y": 380, "text": "💈 Nossos horários de atendimento são das {abertura} às {fechamento}.\\n📞 Se precisar falar com um atendente, nos ligue no (11) 99999-8888. Obrigado! 👍" },
        { "id": "select_barber", "type": "action", "actionType": "select_barber", "title": "1. Escolher Barbeiro", "x": 840, "y": 60, "target": "select_date" },
        { "id": "select_date", "type": "action", "actionType": "select_date", "title": "2. Escolher Data", "x": 1120, "y": 60, "target": "select_slot" },
        { "id": "select_slot", "type": "action", "actionType": "select_slot", "title": "3. Escolher Horário", "x": 1400, "y": 200, "target": "confirmed" },
        { "id": "confirmed", "type": "message", "title": "Confirmação", "x": 1680, "y": 200, "text": "✅ *Agendamento Confirmado!*\\n\\n*Profissional:* {barbeiro}\\n*Horário:* {horario}\\n*Data:* {data}\\n\\nSeu agendamento foi registrado com sucesso! 💈", "target": "offer_plan" },
        { "id": "offer_plan", "type": "action", "actionType": "offer_plan", "title": "4. Clube Assinatura", "x": 1960, "y": 200, "target": "end" },
        { "id": "end", "type": "end", "title": "Fim", "x": 2260, "y": 200 }
      ],
      "edges": [
        { "id": "e_start", "source": "start", "target": "welcome" },
        { "id": "e1", "source": "welcome", "target": "check_intent" },
        { "id": "e2", "source": "check_intent", "sourceHandle": "1", "target": "select_barber" },
        { "id": "e3", "source": "check_intent", "sourceHandle": "2", "target": "other_help" },
        { "id": "e_other_end", "source": "other_help", "target": "end" },
        { "id": "e4", "source": "select_barber", "target": "select_date" },
        { "id": "e5", "source": "select_date", "target": "select_slot" },
        { "id": "e6", "source": "select_slot", "target": "confirmed" },
        { "id": "e7", "source": "confirmed", "target": "offer_plan" },
        { "id": "e_plan_end", "source": "offer_plan", "target": "end" }
      ]
    }'::jsonb
);

-- Services (Offered cuts and services)
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 30,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users (Owners, Barbers, Administrators)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'owner', 'barber')),
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    require_password_change BOOLEAN DEFAULT FALSE,
    photo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Barber Services mapping (with custom overrides)
CREATE TABLE barber_services (
    barber_id UUID REFERENCES users(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    price NUMERIC(10,2),
    duration_minutes INT,
    PRIMARY KEY (barber_id, service_id)
);

-- Clients
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    notes TEXT,
    accept_promotions BOOLEAN DEFAULT FALSE,
    auth_code VARCHAR(6),
    auth_code_expires_at TIMESTAMP,
    auth_session_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_establishment_phone UNIQUE(establishment_id, phone)
);

-- Appointments (Bookings)
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    barber_id UUID REFERENCES users(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    appointment_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
    cancellation_reason VARCHAR(555),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Client Plans Table (Mensal / Quinzenal recurrent cuts)
CREATE TABLE client_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    barber_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(50) NOT NULL CHECK (plan_type IN ('quinzenal', 'mensal')),
    preferred_time TIME NOT NULL,
    preferred_day_of_week INT NOT NULL CHECK (preferred_day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 1=Monday...
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_client_plan UNIQUE(client_id, establishment_id)
);

-- Create Table to track each establishment's active WhatsApp connection metadata
CREATE TABLE whatsapp_sessions (
    establishment_id UUID PRIMARY KEY REFERENCES establishments(id) ON DELETE CASCADE,
    phone VARCHAR(50),
    status VARCHAR(50) DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'qr_ready')),
    qr_code TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Table to store Baileys auth keys and creds in PostgreSQL (stateless orchestration)
CREATE TABLE whatsapp_auth_states (
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    key_type VARCHAR(255) NOT NULL,
    key_id VARCHAR(255) NOT NULL,
    key_data JSONB NOT NULL,
    PRIMARY KEY (establishment_id, key_type, key_id)
);

-- Seed Initial Data
-- 0. Create Master System Establishment (for Super Admin notifications)
INSERT INTO establishments (id, name, slug, primary_color, secondary_color, background_color, text_color, opening_time, closing_time, slot_duration_minutes)
VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    'Sistema BarberHub', 
    'system-master', 
    '#e2a857', 
    '#1e1e24', 
    '#0f0f11', 
    '#f3f4f6', 
    '08:00:00', 
    '18:00:00', 
    30
);

-- 1. Create Establishment 'Barbearia Clássica'
INSERT INTO establishments (name, slug, primary_color, secondary_color, background_color, text_color, opening_time, closing_time, slot_duration_minutes, address, bio)
VALUES (
    'Barbearia Clássica', 
    'classica', 
    '#e2a857', -- Amber/Gold
    '#1e1e24', -- Dark Grey/Black
    '#0f0f11', -- Dark Theme background
    '#f3f4f6', -- Light text
    '09:00:00', 
    '19:00:00', 
    30,
    'Rua das Tesouras, 100 - Bairro da Navalha',
    'A Barbearia Clássica preza pelo corte tradicional de excelência e resgata as tradições dos antigos barbeiros em um ambiente moderno e aconchegante.'
);

-- 2. Create Owner (password: 123456)
INSERT INTO users (establishment_id, name, email, password_hash, role)
SELECT 
    id, 
    'Carlos Proprietário', 
    'carlos@barbearia.com', 
    '$2b$10$DbtqrXirOtgasOyBrvKPXuhDug1frwY8Ar6RijQ2jplsBNmEUIgVW', -- password: '123456'
    'owner'
FROM establishments WHERE slug = 'classica';

-- 3. Create Barbers (Juliano and Caciano)
INSERT INTO users (establishment_id, name, email, password_hash, role, photo_url)
SELECT 
    id, 
    'Juliano', 
    'juliano@barbearia.com', 
    '$2b$10$DbtqrXirOtgasOyBrvKPXuhDug1frwY8Ar6RijQ2jplsBNmEUIgVW', -- password: '123456'
    'barber',
    'https://images.unsplash.com/photo-1621574539437-4b7cb63120b8?auto=format&fit=crop&q=80&w=300&h=300'
FROM establishments WHERE slug = 'classica';

INSERT INTO users (establishment_id, name, email, password_hash, role, photo_url)
SELECT 
    id, 
    'Caciano', 
    'caciano@barbearia.com', 
    '$2b$10$DbtqrXirOtgasOyBrvKPXuhDug1frwY8Ar6RijQ2jplsBNmEUIgVW', -- password: '123456'
    'barber',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300&h=300'
FROM establishments WHERE slug = 'classica';

-- 4. Create Default Services
INSERT INTO services (id, establishment_id, name, description, price, duration_minutes)
SELECT 
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'::uuid,
    id, 
    'Corte de cabelo', 
    'Corte de cabelo social completo com lavagem', 
    45.00, 
    30
FROM establishments WHERE slug = 'classica';

INSERT INTO services (id, establishment_id, name, description, price, duration_minutes)
SELECT 
    'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e'::uuid,
    id, 
    'Corte de cabelo na máquina', 
    'Corte rápido e prático feito inteiramente na máquina', 
    30.00, 
    30
FROM establishments WHERE slug = 'classica';

INSERT INTO services (id, establishment_id, name, description, price, duration_minutes)
SELECT 
    'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f'::uuid,
    id, 
    'Barba', 
    'Aparar a barba com toalha quente e massagem', 
    35.00, 
    30
FROM establishments WHERE slug = 'classica';

-- 5. Associate Services to Barbers (Juliano and Caciano)
INSERT INTO barber_services (barber_id, service_id)
SELECT u.id, s.id 
FROM users u, services s 
WHERE u.role = 'barber' AND u.email IN ('juliano@barbearia.com', 'caciano@barbearia.com');

-- Feedbacks (Customer ratings)
CREATE TABLE feedbacks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_barber_time_active 
ON appointments (barber_id, appointment_time) 
WHERE status != 'cancelled';

-- LID to Real JID Phone persistent mappings
CREATE TABLE IF NOT EXISTS lid_mappings (
    lid VARCHAR(255) PRIMARY KEY,
    phone VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
