import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import pool from '../config/db';
import { outboundQueue } from '../config/redis';
import { toZonedParts, zonedTimeToUtc } from '../utils/datetime';

const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

const redisLockClient = new Redis({ host: redisHost, port: redisPort });

const formatOptionLabel = (num: number): string => {
  const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  if (num >= 1 && num <= 10) {
    return numberEmojis[num - 1];
  }
  return `*${num}.*`;
};

interface InboundJobData {
  establishmentId: string;
  phone: string;
  rawJid: string;
  messageId: string;
  text: string;
  pushName: string;
  fromMe?: boolean;
  timestamp: number;
}

interface BotSession {
  state: 'IDLE' | 'ACTIVE' | 'PAUSED';
  currentNodeId: string;
  waitingForInput: boolean;
  clientPushName?: string;
  barbersList?: { id: string; name: string }[];
  selectedBarberId?: string;
  selectedBarberName?: string;
  servicesList?: { id: string; name: string; price: number; duration: number }[];
  selectedServiceId?: string;
  selectedServiceName?: string;
  selectedServicePrice?: number;
  datesList?: { dateStr: string; label: string }[];
  selectedDateStr?: string;
  selectedDateLabel?: string;
  slotsList?: { iso: string; timeLabel: string }[];
  selectedSlotISO?: string;
  selectedSlotLabel?: string;
  tempBookingsList?: any[];
}

const botSessionsCache = new Map<string, BotSession>();

function sanitizeName(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')  // Remove control characters
    .replace(/<[^>]*>/g, '')               // Strip HTML tags (XSS protection)
    .replace(/[^\p{L}\p{M}\s\-\.']/gu, '')  // Allow only letters, accents, spaces, hyphens, dots, apostrophes
    .replace(/\s+/g, ' ')                   // Collapse whitespace
    .trim()
    .substring(0, 60);                      // Limit max length to 60 characters
}

async function resolveCanonicalPhoneForWorker(phone: string): Promise<string> {
  let clean = phone.split('@')[0].replace(/\D/g, '');
  
  if (!clean.startsWith('55') || clean.length >= 13) {
    try {
      const lidRes = await pool.query(
        `SELECT phone FROM lid_mappings WHERE lid = $1`,
        [clean]
      );
      if (lidRes.rows.length > 0 && lidRes.rows[0].phone) {
        let mapped = lidRes.rows[0].phone.replace(/\D/g, '');
        if (mapped.startsWith('55') && mapped.length === 12) {
          mapped = mapped.substring(0, 4) + '9' + mapped.substring(4);
        }
        return mapped;
      }
    } catch (e) {}
  }

  if (clean.startsWith('55') && clean.length === 12) {
    clean = clean.substring(0, 4) + '9' + clean.substring(4);
  }

  return clean;
}

async function getOrLoadSession(establishmentId: string, phone: string): Promise<BotSession> {
  const cleanPhone = await resolveCanonicalPhoneForWorker(phone);
  const cacheKey = `${establishmentId}:${cleanPhone}`;
  let cached = botSessionsCache.get(cacheKey);

  const res = await pool.query(
    "SELECT bot_state, current_node_id, waiting_for_input, push_name FROM whatsapp_chats WHERE establishment_id = $1 AND phone = $2",
    [establishmentId, cleanPhone]
  );

  if (res.rows.length === 0) {
    await pool.query(
      `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, current_node_id, waiting_for_input)
       VALUES ($1, $2, 'ACTIVE', 'welcome', false)
       ON CONFLICT (establishment_id, phone) DO NOTHING`,
      [establishmentId, cleanPhone]
    );
    const newSession: BotSession = {
      state: 'ACTIVE',
      currentNodeId: 'welcome',
      waitingForInput: false,
      clientPushName: 'Cliente'
    };
    botSessionsCache.set(cacheKey, newSession);
    return newSession;
  }

  const row = res.rows[0];
  if (!cached) {
    cached = {
      state: row.bot_state as any,
      currentNodeId: row.current_node_id || 'welcome',
      waitingForInput: row.waiting_for_input,
      clientPushName: row.push_name || 'Cliente'
    };
    botSessionsCache.set(cacheKey, cached);
  } else {
    cached.state = row.bot_state as any;
    cached.currentNodeId = row.current_node_id || 'welcome';
    cached.waitingForInput = row.waiting_for_input;
    cached.clientPushName = row.push_name || cached.clientPushName;
  }

  return cached;
}

async function saveSession(establishmentId: string, phone: string, session: BotSession) {
  const cleanPhone = await resolveCanonicalPhoneForWorker(phone);
  const cacheKey = `${establishmentId}:${cleanPhone}`;
  botSessionsCache.set(cacheKey, session);
  await pool.query(
    `INSERT INTO whatsapp_chats (establishment_id, phone, bot_state, current_node_id, waiting_for_input, push_name, last_message_time)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (establishment_id, phone)
     DO UPDATE SET bot_state = EXCLUDED.bot_state,
                   current_node_id = EXCLUDED.current_node_id,
                   waiting_for_input = EXCLUDED.waiting_for_input,
                   push_name = COALESCE(EXCLUDED.push_name, whatsapp_chats.push_name),
                   last_message_time = NOW()`,
    [establishmentId, cleanPhone, session.state, session.currentNodeId, session.waitingForInput, session.clientPushName]
  );
  try {
    await redisLockClient.publish('whatsapp-chat-updates', JSON.stringify({
      establishmentId,
      phone: cleanPhone,
      action: 'state_change',
      state: session.state
    }));
  } catch (e) {}
}

async function recordChatMessage(establishmentId: string, phone: string, text: string, fromMe: boolean) {
  const cleanPhone = await resolveCanonicalPhoneForWorker(phone);
  await pool.query(
    `INSERT INTO whatsapp_messages (establishment_id, phone, message_text, from_me, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [establishmentId, cleanPhone, text, fromMe]
  );
  await pool.query(
    `UPDATE whatsapp_chats SET last_message_time = NOW() WHERE establishment_id = $1 AND phone = $2`,
    [establishmentId, cleanPhone]
  );
  if (!fromMe) {
    try {
      await redisLockClient.publish('whatsapp-chat-updates', JSON.stringify({
        establishmentId,
        phone: cleanPhone,
        text,
        fromMe: false,
        timestamp: new Date().toISOString()
      }));
    } catch (err) {
      console.error('[BotWorker] Error publishing SSE chat update:', err);
    }
  }
}

export const botWorker = new Worker<InboundJobData>(
  'whatsapp-inbound-queue',
  async (job: Job<InboundJobData>) => {
    const { establishmentId, phone, text, pushName, fromMe } = job.data;
    const chatLockKey = `lock:chat:${establishmentId}:${phone}`;

    const acquired = await redisLockClient.set(chatLockKey, job.id || 'lock', 'EX', 15, 'NX');

    if (!acquired) {
      throw new Error(`Chat ${phone} at establishment ${establishmentId} is locked. Retrying job...`);
    }

    try {
      console.log(`[BotWorker] Processing message for ${phone} (Tenant: ${establishmentId}, fromMe: ${!!fromMe})...`);

      const isFromMe = !!fromMe;
      if (isFromMe) {
        console.log(`[BotWorker] Chat message for ${phone} is fromMe (${isFromMe}). Skipping record & bot flow.`);
        return;
      }

      await recordChatMessage(establishmentId, phone, text, false);

      const session = await getOrLoadSession(establishmentId, phone);
      session.clientPushName = pushName;

      if (session.state === 'PAUSED') {
        console.log(`[BotWorker] Chat session for ${phone} is PAUSED. Skipping bot flow.`);
        return;
      }

      // Global keyword check for human support request
      const inputLower = text.trim().toLowerCase();
      if (inputLower === 'atendente' || inputLower === 'suporte' || inputLower.includes('falar com atendente') || inputLower.includes('atendimento humano')) {
        session.state = 'PAUSED';
        session.waitingForInput = false;
        await saveSession(establishmentId, phone, session);
        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: '🙋‍♂️ *Atendimento Humano Solicitado!*\n\nUm de nossos atendentes foi notificado e atenderá você em breve por aqui. Por favor, aguarde só um instante! 💈',
        });
        return;
      }

      // Check if client exists (locally or globally, checking phone or via lid_mappings)
      let resolvedPhone = phone;
      try {
        const lidCheck = await pool.query(`SELECT phone FROM lid_mappings WHERE lid = $1`, [phone]);
        if (lidCheck.rows.length > 0 && lidCheck.rows[0].phone) {
          resolvedPhone = lidCheck.rows[0].phone;
        }
      } catch (e) {}

      let clientCheck = await pool.query(
        `SELECT id, name FROM clients 
         WHERE (phone = $1 OR phone = $2) AND (establishment_id = $3 OR establishment_id IS NULL)
         ORDER BY establishment_id DESC NULLS LAST LIMIT 1`,
        [phone, resolvedPhone, establishmentId]
      );

      if (clientCheck.rows.length > 0 && clientCheck.rows[0].id) {
        await pool.query(
          `UPDATE clients SET establishment_id = $1 WHERE id = $2 AND establishment_id IS NULL`,
          [establishmentId, clientCheck.rows[0].id]
        );
      }

      // 1. Client Registration Step
      if (session.currentNodeId === 'register_client') {
        const clientName = sanitizeName(text);
        if (clientName.length < 3) {
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '⚠️ Por favor, digite um nome válido (mínimo de 3 caracteres, sem símbolos ou códigos):',
          });
          return;
        }

        const targetPhone = resolvedPhone || phone;

        await pool.query(
          `INSERT INTO clients (establishment_id, name, phone)
           VALUES ($1, $2, $3)
           ON CONFLICT (establishment_id, phone) 
           DO UPDATE SET name = EXCLUDED.name`,
          [establishmentId, clientName, targetPhone]
        );

        if (phone !== targetPhone && phone.length >= 13) {
          await pool.query(
            `INSERT INTO lid_mappings (lid, phone, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW()`,
            [phone, targetPhone]
          );
        }

        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: `🎉 *Cadastro realizado com sucesso, ${clientName}!*`,
        });

        session.state = 'ACTIVE';
        session.currentNodeId = 'welcome';
        session.waitingForInput = false;
        await saveSession(establishmentId, phone, session);
        // Fallthrough to welcome step below
      } else if (clientCheck.rows.length === 0) {
        session.state = 'ACTIVE';
        session.currentNodeId = 'register_client';
        session.waitingForInput = true;
        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: `Olá! Seja bem-vindo! 💈\n\nIdentificamos que este é o seu primeiro contato conosco. Para continuarmos, *por favor digite seu nome completo*:`,
        });
        await saveSession(establishmentId, phone, session);
        return;
      }

      const clientInfo = clientCheck.rows[0] || { name: pushName || 'Cliente' };

      // As listas de escolha (barbeiros, serviços, datas, horários) vivem apenas no
      // cache em memória, mas `current_node_id` é persistido no banco. Após um
      // restart do worker — ou se o job cair em outra réplica — o cliente ficava
      // preso: o bot esperava um número referente a uma lista que não existia mais
      // e respondia "Opção inválida" para sempre. Aqui detectamos esse estado órfão
      // e reiniciamos a conversa.
      const requiredList: Record<string, keyof BotSession> = {
        process_barber_selection: 'barbersList',
        process_service_selection: 'servicesList',
        process_date_selection: 'datesList',
        process_slot_selection: 'slotsList',
      };

      const needed = requiredList[session.currentNodeId];
      if (needed && !session[needed]) {
        console.warn(`[BotWorker] Estado órfão em ${session.currentNodeId} para ${phone}. Reiniciando fluxo.`);
        session.state = 'ACTIVE';
        session.currentNodeId = 'welcome';
        session.waitingForInput = false;
        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: '🔄 Precisei reiniciar nosso atendimento. Vamos começar de novo!',
        });
        await saveSession(establishmentId, phone, session);
      }

      // 2. Welcome & Barber Selection Menu
      if (session.currentNodeId === 'welcome' || session.currentNodeId === 'select_barber' || session.state === 'IDLE' || !session.currentNodeId) {
        const barbersRes = await pool.query(
          "SELECT id, name FROM users WHERE establishment_id = $1 AND role IN ('owner', 'admin', 'barber') ORDER BY name ASC",
          [establishmentId]
        );

        if (barbersRes.rows.length === 0) {
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '⚠️ Nenhum profissional cadastrado no momento. Por favor, tente novamente mais tarde.',
          });
          return;
        }

        session.barbersList = barbersRes.rows;
        session.currentNodeId = 'process_barber_selection';
        session.state = 'ACTIVE';
        session.waitingForInput = true;

        let menuText = `Olá, *${clientInfo.name}*! Seja bem-vindo! 💈✂️\n\n*Como podemos te ajudar hoje?*\n\n`;
        barbersRes.rows.forEach((b, idx) => {
          menuText += `${formatOptionLabel(idx + 1)} *Agendar com ${b.name}*\n`;
        });
        const supportOptionIdx = barbersRes.rows.length + 1;
        menuText += `${formatOptionLabel(supportOptionIdx)} 💬 *Falar com Atendente*\n`;
        menuText += `\n👉 *Digite apenas o número correspondente:*`;

        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: menuText,
        });
        await saveSession(establishmentId, phone, session);
        return;
      }

      // 3. Process Barber Choice & Show Services Menu
      if (session.currentNodeId === 'process_barber_selection') {
        const choiceNumber = parseInt(text.trim(), 10);
        const supportOptionIdx = (session.barbersList?.length || 0) + 1;

        if (choiceNumber === supportOptionIdx) {
          session.state = 'PAUSED';
          session.waitingForInput = false;
          await saveSession(establishmentId, phone, session);
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '🙋‍♂️ *Atendimento Humano Solicitado!*\n\nUm de nossos atendentes foi notificado e atenderá você em breve por aqui. Por favor, aguarde só um instante! 💈',
          });
          return;
        }

        const choiceIdx = choiceNumber - 1;
        if (isNaN(choiceIdx) || choiceIdx < 0 || !session.barbersList || choiceIdx >= session.barbersList.length) {
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '⚠️ Opção inválida. Por favor, digite o *número* correspondente à opção desejada:',
          });
          return;
        }

        const selectedBarber = session.barbersList[choiceIdx];
        session.selectedBarberId = selectedBarber.id;
        session.selectedBarberName = selectedBarber.name;

        // Fetch services for establishment
        const servicesRes = await pool.query(
          "SELECT id, name, price, duration_minutes FROM services WHERE establishment_id = $1 ORDER BY name ASC",
          [establishmentId]
        );

        if (servicesRes.rows.length === 0) {
          // If no custom services configured, offer standard Corte
          session.servicesList = [{ id: 'default', name: 'Corte de Cabelo', price: 35, duration: 30 }];
        } else {
          session.servicesList = servicesRes.rows.map(s => ({
            id: s.id,
            name: s.name,
            price: parseFloat(s.price || 0),
            duration: s.duration_minutes || 30
          }));
        }

        session.currentNodeId = 'process_service_selection';
        session.waitingForInput = true;

        let menuText = `Perfeito! Você escolheu *${selectedBarber.name}*. 💈\n\n*Escolha o serviço desejado:*\n\n`;
        session.servicesList.forEach((s, idx) => {
          const priceFormatted = s.price > 0 ? ` - R$ ${s.price.toFixed(2).replace('.', ',')}` : '';
          menuText += `${formatOptionLabel(idx + 1)} *${s.name}*${priceFormatted}\n`;
        });
        menuText += `\n👉 *Digite apenas o número do serviço:*`;

        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: menuText,
        });
        await saveSession(establishmentId, phone, session);
        return;
      }

      // 4. Process Service Choice & Show Dates Menu
      if (session.currentNodeId === 'process_service_selection') {
        const choiceIdx = parseInt(text.trim(), 10) - 1;
        if (isNaN(choiceIdx) || choiceIdx < 0 || !session.servicesList || choiceIdx >= session.servicesList.length) {
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '⚠️ Opção inválida. Por favor, digite o *número* do serviço desejado:',
          });
          return;
        }

        const selectedService = session.servicesList[choiceIdx];
        session.selectedServiceId = selectedService.id;
        session.selectedServiceName = selectedService.name;
        session.selectedServicePrice = selectedService.price;

        // Generate next 5 available days
        //
        // Antes o dia vinha de `toISOString()` (UTC) e o rótulo de `getDay()`/
        // `getDate()` (fuso do processo). Num contêiner UTC, depois das 21h no
        // Brasil o "Hoje" oferecido pelo bot já era o dia seguinte.
        const dates: { dateStr: string; label: string }[] = [];
        const todayParts = toZonedParts(new Date());

        for (let i = 0; i < 5; i++) {
          // Meio-dia local evita que o passo de 1 dia caia em cima de uma
          // transição de horário de verão e pule ou repita uma data.
          const anchor = zonedTimeToUtc(todayParts.date, '12:00');
          const target = new Date(anchor.getTime() + i * 24 * 60 * 60 * 1000);
          const parts = toZonedParts(target);
          const dateStr = parts.date;

          let dayLabel = '';
          if (i === 0) dayLabel = 'Hoje';
          else if (i === 1) dayLabel = 'Amanhã';
          else {
            const weekDays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
            // getUTCDay sobre a data local reconstruída dá o dia da semana correto.
            const weekdayIndex = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
            dayLabel = weekDays[weekdayIndex];
          }

          const dayFormatted = `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}`;
          dates.push({ dateStr, label: `${dayLabel} (${dayFormatted})` });
        }

        session.datesList = dates;
        session.currentNodeId = 'process_date_selection';
        session.waitingForInput = true;

        let menuText = `Serviço selecionado: *${selectedService.name}*. ✂️\n\n*Escolha o dia para o seu agendamento:*\n\n`;
        dates.forEach((d, idx) => {
          menuText += `${formatOptionLabel(idx + 1)} *${d.label}*\n`;
        });
        menuText += `\n👉 *Digite o número correspondente à data:*`;

        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: menuText,
        });
        await saveSession(establishmentId, phone, session);
        return;
      }

      // 5. Process Date Choice & Show Time Slots Menu
      if (session.currentNodeId === 'process_date_selection') {
        const choiceIdx = parseInt(text.trim(), 10) - 1;
        if (isNaN(choiceIdx) || choiceIdx < 0 || !session.datesList || choiceIdx >= session.datesList.length) {
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '⚠️ Opção inválida. Por favor, digite o *número* correspondente ao dia desejado:',
          });
          return;
        }

        const selectedDateObj = session.datesList[choiceIdx];
        session.selectedDateStr = selectedDateObj.dateStr;
        session.selectedDateLabel = selectedDateObj.label;

        // Fetch establishment business hours
        const estRes = await pool.query(
          "SELECT opening_time, closing_time, slot_duration_minutes FROM establishments WHERE id = $1",
          [establishmentId]
        );
        const est = estRes.rows[0] || {};
        const openTimeStr = est.opening_time || '08:00';
        const closeTimeStr = est.closing_time || '19:00';
        const slotDuration = est.slot_duration_minutes || 30;

        // Query existing appointments for selected barber & date.
        //
        // A janela é calculada no fuso do estabelecimento. O filtro anterior
        // (`>= $2::date`) usava a data crua e, combinado com a montagem dos slots
        // em UTC puro logo abaixo, produzia uma agenda deslocada em 3 horas: o bot
        // oferecia 05:00–16:00 para uma barbearia configurada das 08:00 às 19:00.
        const dayStart = zonedTimeToUtc(selectedDateObj.dateStr, '00:00');
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        const existingApptsRes = await pool.query(
          `SELECT appointment_time
           FROM appointments
           WHERE barber_id = $1
             AND status != 'cancelled'
             AND appointment_time >= $2
             AND appointment_time < $3`,
          [session.selectedBarberId, dayStart.toISOString(), dayEnd.toISOString()]
        );

        // Comparação por instante (ms), não por rótulo de hora — o rótulo dependia
        // do fuso e não casava com os horários gravados pelo painel web.
        const bookedInstants = new Set(
          existingApptsRes.rows.map((r) => new Date(r.appointment_time).getTime())
        );

        // Generate available slots
        const [openH, openM] = String(openTimeStr).split(':').map(Number);
        const [closeH, closeM] = String(closeTimeStr).split(':').map(Number);

        const slots: { iso: string; timeLabel: string }[] = [];
        let currMinutes = openH * 60 + openM;
        const endMinutes = closeH * 60 + closeM;

        const now = new Date();

        while (currMinutes < endMinutes) {
          const h = Math.floor(currMinutes / 60);
          const m = currMinutes % 60;
          const timeLabel = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

          const slotDate = zonedTimeToUtc(selectedDateObj.dateStr, timeLabel);

          if (slotDate > now && !bookedInstants.has(slotDate.getTime())) {
            slots.push({ iso: slotDate.toISOString(), timeLabel });
          }

          currMinutes += slotDuration;
        }

        if (slots.length === 0) {
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: `⚠️ Não encontramos horários vagos para *${selectedDateObj.label}* com *${session.selectedBarberName}*.\n\nPor favor, escolha outro dia digitando o número:`,
          });
          return;
        }

        session.slotsList = slots;
        session.currentNodeId = 'process_slot_selection';
        session.waitingForInput = true;

        let menuText = `Data escolhida: *${selectedDateObj.label}*. 📅\n\n*Escolha o horário desejado:*\n\n`;
        slots.forEach((s, idx) => {
          menuText += `${formatOptionLabel(idx + 1)} *${s.timeLabel}*\n`;
        });
        menuText += `\n👉 *Digite o número do horário desejado:*`;

        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: menuText,
        });
        await saveSession(establishmentId, phone, session);
        return;
      }

      // 6. Process Slot Choice & Finalize Booking
      if (session.currentNodeId === 'process_slot_selection') {
        const choiceIdx = parseInt(text.trim(), 10) - 1;
        if (isNaN(choiceIdx) || choiceIdx < 0 || !session.slotsList || choiceIdx >= session.slotsList.length) {
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '⚠️ Opção inválida. Por favor, digite o *número* correspondente ao horário desejado:',
          });
          return;
        }

        const selectedSlot = session.slotsList[choiceIdx];
        session.selectedSlotISO = selectedSlot.iso;
        session.selectedSlotLabel = selectedSlot.timeLabel;

        const bookingClientId = clientCheck.rows[0]?.id;
        if (!bookingClientId) {
          // Estado inconsistente (cadastro removido no meio da conversa): reinicia
          // o fluxo em vez de estourar e reprocessar o job cinco vezes.
          await outboundQueue.add('send-whatsapp-message', {
            establishmentId,
            phone,
            text: '⚠️ Não consegui localizar seu cadastro. Vamos recomeçar: envie qualquer mensagem para iniciar de novo.',
          });
          session.state = 'IDLE';
          session.currentNodeId = 'welcome';
          session.waitingForInput = false;
          await saveSession(establishmentId, phone, session);
          return;
        }

        // Insert appointment into database.
        //
        // O índice único (barber_id, appointment_time) pode disparar se alguém
        // tiver pegado o horário entre a exibição do menu e a resposta. Sem este
        // tratamento o job falhava, o BullMQ retentava 5 vezes e o cliente recebia
        // a mesma pergunta repetidamente.
        try {
          await pool.query(
            `INSERT INTO appointments (establishment_id, barber_id, client_id, appointment_time, status, service_id)
             VALUES ($1, $2, $3, $4, 'confirmed', $5)`,
            [
              establishmentId,
              session.selectedBarberId,
              bookingClientId,
              selectedSlot.iso,
              session.selectedServiceId === 'default' ? null : session.selectedServiceId
            ]
          );

          try {
            await redisLockClient.publish('whatsapp-chat-updates', JSON.stringify({
              type: 'appointment_update',
              action: 'created',
              establishmentId,
              client_name: clientCheck.rows[0]?.name || 'Cliente',
              appointment_time: selectedSlot.iso,
              barber_name: session.selectedBarberName
            }));
          } catch (pubErr) {
            console.error('[BotWorker] Failed to publish appointment_update to Redis:', pubErr);
          }
        } catch (insertErr: any) {
          if (insertErr?.code === '23505') {
            await outboundQueue.add('send-whatsapp-message', {
              establishmentId,
              phone,
              text: `😕 Poxa, o horário das *${selectedSlot.timeLabel}* acabou de ser reservado por outra pessoa.\n\nEnvie qualquer mensagem para escolher um novo horário.`,
            });
            session.state = 'IDLE';
            session.currentNodeId = 'welcome';
            session.waitingForInput = false;
            await saveSession(establishmentId, phone, session);
            return;
          }
          throw insertErr;
        }

        const priceStr = session.selectedServicePrice && session.selectedServicePrice > 0 
          ? `\n💰 *Valor:* R$ ${session.selectedServicePrice.toFixed(2).replace('.', ',')}`
          : '';

        const confirmationText = `🎉 *AGENDAMENTO CONFIRMADO COM SUCESSO!* 💈\n\n` +
          `📌 *Cliente:* ${clientCheck.rows[0].name}\n` +
          `📌 *Profissional:* ${session.selectedBarberName}\n` +
          `📌 *Serviço:* ${session.selectedServiceName}${priceStr}\n` +
          `📌 *Data:* ${session.selectedDateLabel}\n` +
          `📌 *Horário:* ${selectedSlot.timeLabel}\n\n` +
          `Te esperamos no horário marcado! Se precisar reagendar ou cancelar, basta nos enviar uma mensagem aqui. Obrigado! 😊✨`;

        await outboundQueue.add('send-whatsapp-message', {
          establishmentId,
          phone,
          text: confirmationText,
        });

        // Reset conversation state
        session.state = 'IDLE';
        session.currentNodeId = 'welcome';
        session.waitingForInput = false;
        await saveSession(establishmentId, phone, session);
        return;
      }

    } finally {
      await redisLockClient.del(chatLockKey);
    }
  },
  {
    connection: { host: redisHost, port: redisPort },
    concurrency: 20,
  }
);
