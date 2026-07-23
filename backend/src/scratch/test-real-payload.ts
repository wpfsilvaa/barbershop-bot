import pool from '../config/db';

async function run() {
  const establishmentId = 'a389122e-9126-40db-999d-62ce97b988d6';

  const name = "";
  const primary_color = "";
  const secondary_color = "";
  const background_color = "";
  const text_color = "";
  const opening_time = "";
  const closing_time = "";
  const slot_duration_minutes = 30;
  const msg_fallback = "";
  
  const bot_flow = {
    "nodes": [
      {"id":"start","type":"start","title":"Início","x":50,"y":250},
      {"id":"welcome","type":"message","title":"Boas-Vindas","x":350,"y":250,"text":"Olá! Seja bem-vindo à Barbearia."},
      {"id":"check_intent","type":"condition","title":"Verificar Opção","x":690,"y":250,"options":[{"key":"1","label":"Agendar","target":"select_barber"},{"key":"2","label":"Contato","target":"other_help"}]},
      {"id":"select_barber","type":"action","actionType":"select_barber","title":"1. Escolher Barbeiro","x":1050,"y":80,"target":"select_date"},
      {"id":"select_date","type":"action","actionType":"select_date","title":"2. Escolher Data","x":1410,"y":80,"target":"select_slot"},
      {"id":"select_slot","type":"action","actionType":"select_slot","title":"3. Escolher Horário","x":1770,"y":250,"target":"confirmed"},
      {"id":"confirmed","type":"message","title":"Confirmação","x":2130,"y":250,"text":"✅ *Agendamento Confirmado!*\n\n*Profissional:* {barbeiro}\n*Horário:* {horario}\n*Data:* {data}\n\nSeu agendamento foi registrado com sucesso! 💈","target":"offer_plan"},
      {"id":"offer_plan","type":"action","actionType":"offer_plan","title":"4. Clube Assinatura","x":2490,"y":250,"target":"end"},
      {"id":"end","type":"end","title":"Fim","x":2850,"y":250},
      {"id":"other_help","type":"message","title":"Informações","x":1050,"y":420,"text":"💈 Nossos horários de atendimento são das {abertura} às {fechamento}.\n📞 Se precisar falar com um atendente, nos ligue no (11) 99999-8888. Obrigado! 👍","target":"end"}
    ],
    "edges": [
      {"id":"e_start_welcome","source":"start","target":"welcome"},
      {"id":"e_welcome_check_intent","source":"welcome","target":"check_intent"},
      {"id":"e_check_intent_1_select_barber","source":"check_intent","sourceHandle":"1","target":"select_barber"},
      {"id":"e_check_intent_2_other_help","source":"check_intent","sourceHandle":"2","target":"other_help"},
      {"id":"e_select_barber_select_date","source":"select_barber","target":"select_date"},
      {"id":"e_select_date_select_slot","source":"select_date","target":"select_slot"},
      {"id":"e_select_slot_confirmed","source":"select_slot","target":"confirmed"},
      {"id":"e_confirmed_offer_plan","source":"confirmed","target":"offer_plan"},
      {"id":"e_offer_plan_end","source":"offer_plan","target":"end"},
      {"id":"e_other_help_end","source":"other_help","target":"end"}
    ]
  };

  try {
    console.log('[Test] Running real payload update query...');
    const result = await pool.query(
      `UPDATE establishments 
       SET name = COALESCE($1, name), 
           primary_color = COALESCE($2, primary_color), 
           secondary_color = COALESCE($3, secondary_color), 
           background_color = COALESCE($4, background_color), 
           text_color = COALESCE($5, text_color), 
           opening_time = COALESCE($6, opening_time), 
           closing_time = COALESCE($7, closing_time), 
           slot_duration_minutes = COALESCE($8, slot_duration_minutes),
           msg_fallback = COALESCE($9, msg_fallback),
           bot_flow = COALESCE($10::jsonb, bot_flow)
       WHERE id = $11
       RETURNING id, name, bot_flow`,
      [
        name === undefined || name === '' ? null : name, 
        primary_color === undefined || primary_color === '' ? null : primary_color, 
        secondary_color === undefined || secondary_color === '' ? null : secondary_color, 
        background_color === undefined || background_color === '' ? null : background_color, 
        text_color === undefined || text_color === '' ? null : text_color, 
        opening_time === undefined || opening_time === '' ? null : opening_time, 
        closing_time === undefined || closing_time === '' ? null : closing_time, 
        slot_duration_minutes === undefined || slot_duration_minutes === null ? null : slot_duration_minutes,
        msg_fallback === undefined ? null : msg_fallback,
        bot_flow ? JSON.stringify(bot_flow) : null,
        establishmentId
      ]
    );
    console.log('[Test] Success!', result.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('[Test] Failed with error:', err);
    process.exit(1);
  }
}

run();
