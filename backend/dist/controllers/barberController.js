"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBarber = exports.updateBarber = exports.createBarber = exports.listPublicBarbers = exports.listBarbers = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = __importDefault(require("../config/db"));
// List all barbers for an establishment (Admin/Owner/Barber dashboard view)
const listBarbers = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT id, name, email, role, is_active, photo_url, created_at 
       FROM users 
       WHERE establishment_id = $1 AND role = 'barber'
       ORDER BY name ASC`, [establishmentId]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('List barbers error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listBarbers = listBarbers;
// List active barbers publicly (for client Web App booking page)
const listPublicBarbers = async (req, res) => {
    const { establishmentId } = req.params;
    try {
        const result = await db_1.default.query(`SELECT id, name, photo_url 
       FROM users 
       WHERE establishment_id = $1 AND role = 'barber' AND is_active = true
       ORDER BY name ASC`, [establishmentId]);
        return res.json(result.rows);
    }
    catch (error) {
        console.error('List public barbers error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.listPublicBarbers = listPublicBarbers;
// Create a new barber (Owner/Admin only)
const createBarber = async (req, res) => {
    const { establishmentId } = req.params;
    const { name, email, password, photo_url } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    try {
        // Check if email already exists
        const emailCheck = await db_1.default.query('SELECT id FROM users WHERE email = $1', [email]);
        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Email already in use.' });
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        const result = await db_1.default.query(`INSERT INTO users (establishment_id, name, email, password_hash, role, photo_url)
       VALUES ($1, $2, $3, $4, 'barber', $5)
       RETURNING id, name, email, role, is_active, photo_url, created_at`, [establishmentId, name, email, passwordHash, photo_url || null]);
        return res.status(201).json(result.rows[0]);
    }
    catch (error) {
        console.error('Create barber error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.createBarber = createBarber;
// Update a barber (Owner/Admin only)
const updateBarber = async (req, res) => {
    const { establishmentId, barberId } = req.params;
    const { name, email, password, is_active, photo_url } = req.body;
    try {
        // Verify that the barber belongs to this establishment (IDOR mitigation)
        const barberCheck = await db_1.default.query('SELECT id, password_hash FROM users WHERE id = $1 AND establishment_id = $2 AND role = \'barber\'', [barberId, establishmentId]);
        if (barberCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Barber not found in this establishment.' });
        }
        let query = 'UPDATE users SET name = $1, email = $2, is_active = $3, photo_url = $4';
        const queryParams = [name, email, is_active === undefined ? true : is_active, photo_url || null];
        if (password && password.trim() !== '') {
            const salt = await bcryptjs_1.default.genSalt(10);
            const passwordHash = await bcryptjs_1.default.hash(password, salt);
            query += ', password_hash = $5 WHERE id = $6 AND establishment_id = $7 RETURNING id, name, email, role, is_active, photo_url';
            queryParams.push(passwordHash, barberId, establishmentId);
        }
        else {
            query += ' WHERE id = $5 AND establishment_id = $6 RETURNING id, name, email, role, is_active, photo_url';
            queryParams.push(barberId, establishmentId);
        }
        const result = await db_1.default.query(query, queryParams);
        return res.json(result.rows[0]);
    }
    catch (error) {
        console.error('Update barber error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.updateBarber = updateBarber;
// Delete/deactivate barber (Owner/Admin only)
const deleteBarber = async (req, res) => {
    const { establishmentId, barberId } = req.params;
    try {
        // Verify that the barber belongs to this establishment (IDOR mitigation)
        const barberCheck = await db_1.default.query('SELECT id FROM users WHERE id = $1 AND establishment_id = $2 AND role = \'barber\'', [barberId, establishmentId]);
        if (barberCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Barber not found in this establishment.' });
        }
        // Instead of hard-deleting (which breaks foreign keys for existing appointments), we deactivate or delete.
        // Let's do a hard delete if they have no appointments, or toggle is_active to false if they do.
        const appointmentCheck = await db_1.default.query('SELECT id FROM appointments WHERE barber_id = $1 LIMIT 1', [barberId]);
        if (appointmentCheck.rows.length > 0) {
            // Deactivate
            await db_1.default.query('UPDATE users SET is_active = false WHERE id = $1', [barberId]);
            return res.json({ message: 'Barber has past appointments. Deactivated successfully instead of deleting.' });
        }
        else {
            // Hard delete
            await db_1.default.query('DELETE FROM users WHERE id = $1', [barberId]);
            return res.json({ message: 'Barber deleted successfully.' });
        }
    }
    catch (error) {
        console.error('Delete barber error:', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
exports.deleteBarber = deleteBarber;
