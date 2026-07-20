-- Alter establishments table to add customized message template strings
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS msg_welcome TEXT DEFAULT 'Olá, *{cliente}*! Seja bem-vindo à {estabelecimento}. 💈\n\nGostaria de agendar um horário?\n\n*1* - Sim, por favor\n*2* - Não, obrigado';
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS msg_select_barber TEXT DEFAULT 'Excelente! Escolha o profissional que deseja:\n\n{barbeiros}\nDigite o número correspondente:';
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS msg_select_date TEXT DEFAULT 'Perfeito! Para qual dia deseja agendar o horário?\n\n{datas}\nDigite o número correspondente:';
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS msg_select_slot TEXT DEFAULT 'Estes são os horários disponíveis com *{barbeiro}* para {data}:\n\n{horarios}\nDigite o número correspondente:';
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS msg_confirmed TEXT DEFAULT '✅ *Agendamento Confirmado!*\n\n*Profissional:* {barbeiro}\n*Horário:* {horario}\n*Data:* {data}\n\nSeu agendamento foi registrado com sucesso. Te esperamos lá! 💈';
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS msg_fallback TEXT DEFAULT 'Opção inválida. Por favor, responda com um dos números correspondentes da lista.';

-- Alter appointments table to support cancellation reason
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(555);

-- Create Client Plans Table (Mensal / Quinzenal recurrent cuts)
CREATE TABLE IF NOT EXISTS client_plans (
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
