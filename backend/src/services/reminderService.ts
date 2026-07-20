import pool from '../config/db';
import { sendOrchestratedMessage } from './whatsappManager';

// Run reminder scheduler once a day
export function startReminderScheduler() {
  console.log('Reminder scheduler loaded. Initializing checking intervals...');
  
  // Run checks once on boot after 15 seconds, then every 24 hours
  setTimeout(() => {
    runAllDailyChecks();
  }, 15000);

  // Set interval for every 24 hours
  setInterval(() => {
    runAllDailyChecks();
  }, 24 * 60 * 60 * 1000);
}

async function runAllDailyChecks() {
  try {
    await checkAndSendReminders();
  } catch (err) {
    console.error('Error on scheduled checkAndSendReminders:', err);
  }

  try {
    await checkAndSendLicenseReminders();
  } catch (err) {
    console.error('Error on scheduled checkAndSendLicenseReminders:', err);
  }

  try {
    await cleanExpiredChatHistory();
  } catch (err) {
    console.error('Error on scheduled cleanExpiredChatHistory:', err);
  }
}

async function checkAndSendReminders() {
  console.log('⏰ Running daily client plan appointment reminder checker...');
  
  try {
    // Fetch all active plan bookings for TOMORROW across all establishments
    const result = await pool.query(
      `SELECT a.establishment_id,
              a.appointment_time, 
              b.name as barber_name, 
              c.name as client_name, c.phone as client_phone,
              p.plan_type
       FROM appointments a
       JOIN client_plans p ON a.client_id = p.client_id AND a.establishment_id = p.establishment_id
       JOIN users b ON a.barber_id = b.id
       JOIN clients c ON a.client_id = c.id
       WHERE a.status = 'confirmed' 
         AND p.is_active = true
         AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE + INTERVAL '1 day'`
    );

    if (result.rows.length > 0) {
      console.log(`[ReminderService] Found ${result.rows.length} plan-based bookings for tomorrow.`);
    }

    for (const appt of result.rows) {
      const { establishment_id, appointment_time, barber_name, client_name, client_phone, plan_type } = appt;
      
      const date = new Date(appointment_time);
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      
      const reminderText = `⏰ *Lembrete de Horário (Clube de Assinatura)*\n\n` +
                           `Olá, *${client_name}*! Passando para te lembrar que seu corte de cabelo (${plan_type === 'quinzenal' ? 'Plano Quinzenal' : 'Plano Mensal'}) ` +
                           `com o profissional *${barber_name}* está agendado para amanhã às *${timeStr}*.\n\nTe esperamos lá! 💈`;

      console.log(`[ReminderService] Enqueuing plan reminder for ${client_name} (${client_phone}) for tomorrow at ${timeStr}...`);
      await sendOrchestratedMessage(establishment_id, client_phone, reminderText);
    }
  } catch (error) {
    console.error(`[ReminderService] Error checking client plan reminders:`, error);
  }
}

async function checkAndSendLicenseReminders() {
  console.log('⏰ Running daily license expiration reminders (3 days warning)...');

  try {
    // Search for establishments expiring in exactly 3 days
    const result = await pool.query(
      `SELECT e.id as establishment_id, e.name as establishment_name, e.expires_at,
              u.name as owner_name, u.phone as owner_phone
       FROM establishments e
       JOIN users u ON e.id = u.establishment_id AND u.role = 'owner'
       WHERE e.is_active = true
         AND DATE(e.expires_at AT TIME ZONE 'UTC') = CURRENT_DATE + INTERVAL '3 days'`
    );

    if (result.rows.length > 0) {
      console.log(`[ReminderService] Found ${result.rows.length} establishments expiring in 3 days. Enqueuing warnings...`);
    }

    for (const row of result.rows) {
      const { establishment_id, establishment_name, expires_at, owner_name, owner_phone } = row;
      if (!owner_phone) continue;

      const date = new Date(expires_at);
      const dateStr = date.toLocaleDateString('pt-BR');

      const messageText = `⚠️ *Lembrete de Vencimento BarberHub* ⚠️\n\n` +
                          `Olá, *${owner_name}*!\n\nPassando para lembrar que a licença do seu estabelecimento *${establishment_name}* expira em exatamente *3 dias* (em *${dateStr}*).\n\n` +
                          `Evite a interrupção dos seus serviços. Realize o pagamento de renovação e envie o comprovante para nós!\n\n` +
                          `Atenciosamente,\n*Equipe BarberHub* 💈`;

      console.log(`[ReminderService] Enqueuing license expiration warning to ${owner_name} (${owner_phone}) via system handler...`);
      
      // Enqueue message via master system establishment UUID
      await sendOrchestratedMessage('00000000-0000-0000-0000-000000000000', owner_phone, messageText);
    }
  } catch (error) {
    console.error('[ReminderService] Error in checkAndSendLicenseReminders:', error);
  }
}

async function cleanExpiredChatHistory() {
  console.log('⏰ Running daily cleanup for chat history older than 30 days...');
  try {
    const resMsgs = await pool.query("DELETE FROM whatsapp_messages WHERE created_at < NOW() - INTERVAL '30 days'");
    const resChats = await pool.query("DELETE FROM whatsapp_chats WHERE last_message_time < NOW() - INTERVAL '30 days'");
    console.log(`[DatabaseCleanup] Deleted ${resMsgs.rowCount || 0} expired messages and ${resChats.rowCount || 0} expired chat sessions.`);
  } catch (err) {
    console.error('[DatabaseCleanup] Failed to cleanup expired chat history:', err);
  }
}
