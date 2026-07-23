-- Migração incremental e idempotente.
--
-- `schema.sql` começa com DROP TABLE: rodá-lo em um banco existente apaga tudo.
-- Este arquivo aplica no banco atual só as diferenças identificadas na auditoria,
-- sem perder dados. Pode ser executado mais de uma vez com segurança.
--
--   psql "$DATABASE_URL" -f backend/migrations/001_fix_missing_schema.sql

BEGIN;

-- 1. Colunas usadas pelo código mas ausentes no schema ------------------------
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;
ALTER TABLE clients        ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
ALTER TABLE lid_mappings   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 2. Tabelas do motor de chat (o bot falhava na primeira mensagem sem elas) ----
CREATE TABLE IF NOT EXISTS whatsapp_chats (
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    phone VARCHAR(50) NOT NULL,
    push_name VARCHAR(255),
    profile_picture_url TEXT,
    bot_state VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (bot_state IN ('IDLE', 'ACTIVE', 'PAUSED')),
    current_node_id VARCHAR(100) DEFAULT 'welcome',
    waiting_for_input BOOLEAN DEFAULT FALSE,
    last_message_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (establishment_id, phone)
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id BIGSERIAL PRIMARY KEY,
    establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
    phone VARCHAR(50) NOT NULL,
    message_text TEXT,
    from_me BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Integridade --------------------------------------------------------------

-- Um feedback por agendamento (o SELECT-then-INSERT do controller deixava passar
-- duplicatas sob concorrência). Remove duplicatas pré-existentes antes de criar.
DELETE FROM feedbacks f
USING feedbacks mais_novo
WHERE f.appointment_id = mais_novo.appointment_id
  AND f.created_at < mais_novo.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedbacks_appointment ON feedbacks (appointment_id);

-- Impede múltiplos cadastros globais (establishment_id IS NULL) do mesmo telefone,
-- que faziam o login do portal cair em cadastros diferentes a cada acesso.
-- ATENÇÃO: se este índice falhar, existem duplicatas a consolidar manualmente —
-- rode a consulta abaixo antes de repetir a migração:
--   SELECT phone, count(*) FROM clients WHERE establishment_id IS NULL
--   GROUP BY phone HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_global_phone
ON clients (phone) WHERE establishment_id IS NULL;

-- 4. Índices de performance ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clients_phone                ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_last_message  ON whatsapp_chats (last_message_time DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat       ON whatsapp_messages (establishment_id, phone, id DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON whatsapp_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_appointments_establishment_time ON appointments (establishment_id, appointment_time);
CREATE INDEX IF NOT EXISTS idx_appointments_client          ON appointments (client_id);

COMMIT;
