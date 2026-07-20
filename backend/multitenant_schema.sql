-- Create Table to track each establishment's active WhatsApp connection metadata
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    establishment_id UUID PRIMARY KEY REFERENCES establishments(id) ON DELETE CASCADE,
    phone VARCHAR(50),
    status VARCHAR(50) DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'qr_ready')),
    qr_code TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Table to store Baileys auth keys and creds in PostgreSQL (stateless orchestration)
CREATE TABLE IF NOT EXISTS whatsapp_auth_states (
    establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
    key_type VARCHAR(255) NOT NULL,
    key_id VARCHAR(255) NOT NULL,
    key_data JSONB NOT NULL,
    PRIMARY KEY (establishment_id, key_type, key_id)
);
