"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignBarberServices = exports.listBarberServices = exports.deleteService = exports.updateService = exports.createService = exports.listPublicServices = exports.listServices = void 0;
const db_1 = __importDefault(require("../config/db"));
// 1. List all services for an establishment (Private)
const listServices = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT id, name, description, price, duration_minutes, is_active 
       FROM services 
       WHERE establishment_id = $1 
       ORDER BY name ASC`, [establishmentId]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('List services error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listServices = listServices;
// 2. List all active services (Public)
const listPublicServices = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT id, name, description, price, duration_minutes 
       FROM services 
       WHERE establishment_id = $1 AND is_active = true 
       ORDER BY name ASC`, [establishmentId]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('List public services error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listPublicServices = listPublicServices;
// 3. Create a new service (Owner/Admin)
const createService = async (req, res) => {
    const { establishmentId } = req.params;
    const { name, description, price, duration_minutes } = req.body;
    if (!name || price === undefined || !duration_minutes) {
        return res.status(400).json({ error: 'Name, price, and duration are required.' });
    }
    try {
        const result = await db_1.default.query(`INSERT INTO services (establishment_id, name, description, price, duration_minutes) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, description, price, duration_minutes, is_active`, [establishmentId, name, description, price, duration_minutes]);
        return res.status(201).json(result.rows[0]);
    }
    catch (error) {
        console.error('Create service error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.createService = createService;
// 4. Update an existing service (Owner/Admin)
const updateService = async (req, res) => {
    const { establishmentId, serviceId } = req.params;
    const { name, description, price, duration_minutes, is_active } = req.body;
    try {
        const result = await db_1.default.query(`UPDATE services 
       SET name = $1, description = $2, price = $3, duration_minutes = $4, is_active = $5 
       WHERE id = $6 AND establishment_id = $7 
       RETURNING id, name, description, price, duration_minutes, is_active`, [name, description, price, duration_minutes, is_active, serviceId, establishmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Service not found.' });
        }
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Update service error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.updateService = updateService;
// 5. Delete a service (Owner/Admin)
const deleteService = async (req, res) => {
    const { establishmentId, serviceId } = req.params;
    try {
        const result = await db_1.default.query(`DELETE FROM services WHERE id = $1 AND establishment_id = $2 RETURNING id`, [serviceId, establishmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Service not found.' });
        }
        return res.json({ message: 'Service deleted successfully.' });
    }
    catch (error) {
        console.error('Delete service error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.deleteService = deleteService;
// 6. List services assigned to a specific barber
const listBarberServices = async (req, res) => {
    const { barberId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT s.id, s.name, s.description,
              COALESCE(bs.price, s.price) as price, 
              COALESCE(bs.duration_minutes, s.duration_minutes) as duration_minutes,
              bs.price as custom_price,
              bs.duration_minutes as custom_duration_minutes,
              s.price as default_price,
              s.duration_minutes as default_duration_minutes
       FROM services s
       JOIN barber_services bs ON s.id = bs.service_id
       WHERE bs.barber_id = $1 AND s.is_active = true
       ORDER BY s.name ASC`, [barberId]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('List barber services error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listBarberServices = listBarberServices;
// 7. Assign/update services for a specific barber (Owner/Admin or the Barber himself)
const assignBarberServices = async (req, res) => {
    const { barberId } = req.params;
    const { serviceIds, services } = req.body;
    if (req.user?.role === 'barber' && req.user?.id !== barberId) {
        return res.status(403).json({ error: 'Permission denied. You can only update your own prices.' });
    }
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        if (Array.isArray(services)) {
            await client.query('DELETE FROM barber_services WHERE barber_id = $1', [barberId]);
            for (const item of services) {
                await client.query(`INSERT INTO barber_services (barber_id, service_id, price, duration_minutes) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (barber_id, service_id) DO UPDATE 
           SET price = EXCLUDED.price, duration_minutes = EXCLUDED.duration_minutes`, [
                    barberId,
                    item.serviceId,
                    item.price !== undefined && item.price !== null && String(item.price).trim() !== '' ? parseFloat(item.price) : null,
                    item.duration_minutes !== undefined && item.duration_minutes !== null && String(item.duration_minutes).trim() !== '' ? parseInt(item.duration_minutes, 10) : null
                ]);
            }
        }
        else if (Array.isArray(serviceIds)) {
            await client.query('DELETE FROM barber_services WHERE barber_id = $1', [barberId]);
            for (const serviceId of serviceIds) {
                await client.query('INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [barberId, serviceId]);
            }
        }
        else {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Either services or serviceIds array is required.' });
        }
        await client.query('COMMIT');
        return res.json({ message: 'Services updated for barber successfully.' });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Assign barber services error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
    finally {
        client.release();
    }
};
exports.assignBarberServices = assignBarberServices;
