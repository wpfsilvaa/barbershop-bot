"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePlan = exports.createOrUpdatePlan = exports.listPlans = void 0;
exports.generateFutureBookingsForPlan = generateFutureBookingsForPlan;
const db_1 = __importDefault(require("../config/db"));
// List active client plans for an establishment
const listPlans = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT p.id, p.plan_type, p.preferred_time, p.preferred_day_of_week, p.is_active, p.created_at,
              b.id as barber_id, b.name as barber_name,
              c.id as client_id, c.name as client_name, c.phone as client_phone
       FROM client_plans p
       JOIN users b ON p.barber_id = b.id
       JOIN clients c ON p.client_id = c.id
       WHERE p.establishment_id = $1
       ORDER BY c.name ASC`, [establishmentId]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('List plans error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listPlans = listPlans;
// Create or update plan for a client
const createOrUpdatePlan = async (req, res) => {
    const { establishmentId } = req.params;
    const { client_phone, client_name, barber_id, plan_type, preferred_time, preferred_day_of_week } = req.body;
    if (!client_phone || !client_name || !barber_id || !plan_type || !preferred_time || preferred_day_of_week === undefined) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        // 1. Check if barber belongs to this establishment
        const barberCheck = await client.query('SELECT id FROM users WHERE id = $1 AND establishment_id = $2 AND role = \'barber\'', [barber_id, establishmentId]);
        if (barberCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid barber for this establishment.' });
        }
        // 2. Fetch or create client by phone
        let clientId;
        const clientCheck = await client.query('SELECT id FROM clients WHERE phone = $1 AND establishment_id = $2', [client_phone, establishmentId]);
        if (clientCheck.rows.length > 0) {
            clientId = clientCheck.rows[0].id;
            await client.query('UPDATE clients SET name = $1 WHERE id = $2', [client_name, clientId]);
        }
        else {
            const newClient = await client.query('INSERT INTO clients (establishment_id, name, phone) VALUES ($1, $2, $3) RETURNING id', [establishmentId, client_name, client_phone]);
            clientId = newClient.rows[0].id;
        }
        // 3. Insert or update the plan (UPSERT)
        const planResult = await client.query(`INSERT INTO client_plans (establishment_id, client_id, barber_id, plan_type, preferred_time, preferred_day_of_week, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (client_id, establishment_id) 
       DO UPDATE SET barber_id = EXCLUDED.barber_id,
                     plan_type = EXCLUDED.plan_type,
                     preferred_time = EXCLUDED.preferred_time,
                     preferred_day_of_week = EXCLUDED.preferred_day_of_week,
                     is_active = EXCLUDED.is_active
       RETURNING id, plan_type, preferred_time, preferred_day_of_week, is_active`, [establishmentId, clientId, barber_id, plan_type, preferred_time, preferred_day_of_week]);
        // 4. Run instant recurrence scheduler generator for the next 4 weeks
        await generateFutureBookingsForPlan(client, String(establishmentId), clientId, barber_id, plan_type, preferred_time, preferred_day_of_week);
        await client.query('COMMIT');
        return res.status(201).json(planResult.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Create or update plan error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
    finally {
        client.release();
    }
};
exports.createOrUpdatePlan = createOrUpdatePlan;
// Delete/Deactivate Plan
const deletePlan = async (req, res) => {
    const { establishmentId, planId } = req.params;
    try {
        const result = await db_1.default.query('DELETE FROM client_plans WHERE id = $1 AND establishment_id = $2 RETURNING id', [planId, establishmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Plan not found.' });
        }
        return res.json({ message: 'Recurrent plan cancelled successfully.' });
    }
    catch (error) {
        console.error('Delete plan error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.deletePlan = deletePlan;
// Recurrence Scheduler Helper
async function generateFutureBookingsForPlan(dbClient, establishmentId, clientId, barberId, planType, preferredTime, preferredDayOfWeek, serviceId) {
    const weeksToBook = 4; // Generate slots up to 4 weeks ahead
    const now = new Date();
    for (let i = 0; i < weeksToBook; i++) {
        // If biweekly and this is an odd week index, skip (recurrence spacing!)
        if (planType === 'quinzenal' && i % 2 !== 0) {
            continue;
        }
        // Find target date
        const targetDate = new Date(now);
        // Move forward i weeks
        targetDate.setDate(targetDate.getDate() + (i * 7));
        // Adjust to the preferred day of the week
        const currentDay = targetDate.getDay();
        const dayDifference = preferredDayOfWeek - currentDay;
        targetDate.setDate(targetDate.getDate() + dayDifference);
        // Ensure the slot is in the future
        if (targetDate <= now) {
            // If it is past or today, look up the target day next week
            targetDate.setDate(targetDate.getDate() + 7);
        }
        // Combine Date and Time
        const dateStr = targetDate.toISOString().split('T')[0];
        const appointmentTimeISO = new Date(`${dateStr}T${preferredTime}`).toISOString();
        // Check if appointment already exists for this client at this time
        const clientApptCheck = await dbClient.query(`SELECT id FROM appointments 
       WHERE client_id = $1 AND appointment_time = $2 AND status != 'cancelled'`, [clientId, appointmentTimeISO]);
        if (clientApptCheck.rows.length > 0) {
            continue; // Client is already booked at this time
        }
        // Check if barber is already booked at this time (conflict protection)
        const barberCheck = await dbClient.query(`SELECT id FROM appointments 
       WHERE barber_id = $1 AND appointment_time = $2 AND status != 'cancelled'`, [barberId, appointmentTimeISO]);
        if (barberCheck.rows.length > 0) {
            continue; // Barber is busy. Skip auto-booking for this week to prevent override.
        }
        // Resolve service id retroactively if not supplied (using first active service)
        let finalServiceId = serviceId;
        if (!finalServiceId) {
            const serviceQuery = await dbClient.query('SELECT id FROM services WHERE establishment_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1', [establishmentId]);
            finalServiceId = serviceQuery.rows.length > 0 ? serviceQuery.rows[0].id : null;
        }
        // Auto insert appointment
        await dbClient.query(`INSERT INTO appointments (establishment_id, barber_id, client_id, service_id, appointment_time, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed')`, [establishmentId, barberId, clientId, finalServiceId, appointmentTimeISO]);
    }
}
