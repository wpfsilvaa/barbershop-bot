"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usePostgresAuthState = usePostgresAuthState;
const baileys_1 = require("@whiskeysockets/baileys");
const db_1 = __importDefault(require("../config/db"));
async function usePostgresAuthState(establishmentId) {
    const readKey = async (type, id) => {
        try {
            const res = await db_1.default.query('SELECT key_data FROM whatsapp_auth_states WHERE establishment_id = $1 AND key_type = $2 AND key_id = $3', [establishmentId, type, id]);
            if (res.rows.length === 0)
                return null;
            return JSON.parse(JSON.stringify(res.rows[0].key_data), baileys_1.BufferJSON.reviver);
        }
        catch (err) {
            console.error(`Postgres auth read key error for ${type}-${id}:`, err);
            return null;
        }
    };
    const writeKey = async (type, id, data) => {
        try {
            if (data === null || data === undefined) {
                await db_1.default.query('DELETE FROM whatsapp_auth_states WHERE establishment_id = $1 AND key_type = $2 AND key_id = $3', [establishmentId, type, id]);
            }
            else {
                const jsonStr = JSON.stringify(data, baileys_1.BufferJSON.replacer);
                await db_1.default.query(`INSERT INTO whatsapp_auth_states (establishment_id, key_type, key_id, key_data)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (establishment_id, key_type, key_id) 
           DO UPDATE SET key_data = EXCLUDED.key_data`, [establishmentId, type, id, jsonStr]);
            }
        }
        catch (err) {
            console.error(`Postgres auth write key error for ${type}-${id}:`, err);
        }
    };
    // 1. Load or initialize credentials
    let creds = await readKey('creds', 'current');
    if (!creds) {
        creds = (0, baileys_1.initAuthCreds)();
        await writeKey('creds', 'current', creds);
    }
    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let val = await readKey(type, id);
                        if (type === 'app-state-sync-key' && val) {
                            val = baileys_1.proto.Message.AppStateSyncKeyData.fromObject(val);
                        }
                        data[id] = val;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const type in data) {
                        for (const id in data[type]) {
                            const value = data[type][id];
                            tasks.push(writeKey(type, id, value));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeKey('creds', 'current', creds);
        }
    };
}
