"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = __importDefault(require("./config/db"));
async function initDatabase() {
    console.log('Starting PostgreSQL database initialization...');
    const sqlPath = path_1.default.join(__dirname, '../schema.sql');
    if (!fs_1.default.existsSync(sqlPath)) {
        console.error(`Schema SQL file not found at: ${sqlPath}`);
        process.exit(1);
    }
    const sqlContent = fs_1.default.readFileSync(sqlPath, 'utf8');
    try {
        console.log('Connecting to PostgreSQL and running migrations...');
        await db_1.default.query(sqlContent);
        console.log('✅ Database schemas created and initial seed data populated successfully.');
    }
    catch (error) {
        console.error('❌ Error initializing database:', error);
    }
    finally {
        await db_1.default.end();
        console.log('Pool closed.');
    }
}
initDatabase();
