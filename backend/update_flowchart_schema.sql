-- Alter establishments to add bot_flow JSONB column
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS bot_flow JSONB DEFAULT '{
  "nodes": [
    { "id": "welcome", "type": "message", "title": "Boas-Vindas", "x": 60, "y": 200, "text": "Olá! Seja bem-vindo à Barbearia. " },
    { "id": "check_intent", "type": "condition", "title": "Verificar Opção", "x": 360, "y": 200, "options": [
      { "key": "1", "label": "Agendar", "target": "select_barber" },
      { "key": "2", "label": "Contato", "target": "other_help" }
    ]},
    { "id": "other_help", "type": "message", "title": "Informações", "x": 640, "y": 380, "text": "💈 Nossos horários de atendimento são das {abertura} às {fechamento}.\\n📞 Se precisar falar com um atendente, nos ligue no (11) 99999-8888. Obrigado! 👍" },
    { "id": "select_barber", "type": "action", "actionType": "select_barber", "title": "1. Escolher Barbeiro", "x": 640, "y": 60, "target": "select_date" },
    { "id": "select_date", "type": "action", "actionType": "select_date", "title": "2. Escolher Data", "x": 920, "y": 60, "target": "select_slot" },
    { "id": "select_slot", "type": "action", "actionType": "select_slot", "title": "3. Escolher Horário", "x": 1200, "y": 200, "target": "confirmed" },
    { "id": "confirmed", "type": "message", "title": "Confirmação", "x": 1480, "y": 200, "text": "✅ *Agendamento Confirmado!*\\n\\n*Profissional:* {barbeiro}\\n*Horário:* {horario}\\n*Data:* {data}\\n\\nSeu agendamento foi registrado com sucesso! 💈", "target": "offer_plan" },
    { "id": "offer_plan", "type": "action", "actionType": "offer_plan", "title": "4. Clube Assinatura", "x": 1760, "y": 200 }
  ],
  "edges": [
    { "id": "e1", "source": "welcome", "target": "check_intent" },
    { "id": "e2", "source": "check_intent", "sourceHandle": "1", "target": "select_barber" },
    { "id": "e3", "source": "check_intent", "sourceHandle": "2", "target": "other_help" },
    { "id": "e4", "source": "select_barber", "target": "select_date" },
    { "id": "e5", "source": "select_date", "target": "select_slot" },
    { "id": "e6", "source": "select_slot", "target": "confirmed" },
    { "id": "e7", "source": "confirmed", "target": "offer_plan" }
  ]
}'::jsonb;
