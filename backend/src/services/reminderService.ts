import pool from '../config/db';
import { getActiveEstablishmentSockets } from './whatsappManager';

// Run reminder scheduler once a day
export function startReminderScheduler() {
  console.log('Reminder scheduler loaded. Initializing checking intervals...');
  
  // Run check once on boot after 15 seconds, then every 24 hours
  setTimeout(() => {
    checkAndSendReminders().catch((err) => console.error('Error on initial checkAndSendReminders:', err));
  }, 15000);

  // Set interval for every 24 hours
  setInterval(() => {
    checkAndSendReminders().catch((err) => console.error('Error on scheduled checkAndSendReminders:', err));
  }, 24 * 60 * 60 * 1000);
}

async function checkAndSendReminders() {
  console.log('⏰ Running daily client plan appointment reminder checker...');
  
  const activeSessions = getActiveEstablishmentSockets();
  if (activeSessions.length === 0) {
    console.log('ℹ️ No active WhatsApp sessions running. Skipping reminders.');
    return;
  }

  for (const [establishmentId, sock] of activeSessions) {
    try {
      // Query appointments for TOMORROW where client has an active subscription plan inside this establishment
      const result = await pool.query(
        `SELECT a.appointment_time, 
                b.name as barber_name, 
                c.name as client_name, c.phone as client_phone,
                p.plan_type
         FROM appointments a
         JOIN client_plans p ON a.client_id = p.client_id AND a.establishment_id = p.establishment_id
         JOIN users b ON a.barber_id = b.id
         JOIN clients c ON a.client_id = c.id
         WHERE a.status = 'confirmed' 
           AND p.is_active = true
           AND a.establishment_id = $1
           AND DATE(a.appointment_time AT TIME ZONE 'UTC') = CURRENT_DATE + INTERVAL '1 day'`,
        [establishmentId]
      );

      if (result.rows.length > 0) {
        console.log(`[ReminderService] Establishment ${establishmentId}: Found ${result.rows.length} plan-based bookings for tomorrow.`);
      }

      for (const appt of result.rows) {
        const { appointment_time, barber_name, client_name, client_phone, plan_type } = appt;
        
        const date = new Date(appointment_time);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        const clientJid = client_phone.includes('@') ? client_phone : `${client_phone}@s.whatsapp.net`;
        
        const reminderText = `⏰ *Lembrete de Horário (Clube de Assinatura)*\n\n` +
                             `Olá, *${client_name}*! Passando para te lembrar que seu corte de cabelo (${plan_type === 'quinzenal' ? 'Plano Quinzenal' : 'Plano Mensal'}) ` +
                             `com o profissional *${barber_name}* está agendado para amanhã às *${timeStr}*.\n\nTe esperamos lá! 💈`;

        console.log(`[ReminderService] Sending plan reminder to ${client_name} (${client_phone}) for tomorrow at ${timeStr} for establishment ${establishmentId}...`);
        
        await sock.sendMessage(clientJid, { text: reminderText });
      }
    } catch (error) {
      console.error(`[ReminderService] Error checking reminders for establishment ${establishmentId}:`, error);
    }
  }
}
