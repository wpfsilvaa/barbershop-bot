import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { Pool } from 'pg';

export async function usePostgresAuthState(pool: Pool, establishmentId: string) {
  
  const readKey = async (type: string, id: string) => {
    try {
      const res = await pool.query(
        'SELECT key_data FROM whatsapp_auth_states WHERE establishment_id = $1 AND key_type = $2 AND key_id = $3',
        [establishmentId, type, id]
      );
      if (res.rows.length === 0) return null;
      return JSON.parse(JSON.stringify(res.rows[0].key_data), BufferJSON.reviver);
    } catch (err) {
      console.error(`Postgres auth read key error for ${type}-${id}:`, err);
      return null;
    }
  };

  const writeKey = async (type: string, id: string, data: any) => {
    try {
      if (data === null || data === undefined) {
        await pool.query(
          'DELETE FROM whatsapp_auth_states WHERE establishment_id = $1 AND key_type = $2 AND key_id = $3',
          [establishmentId, type, id]
        );
      } else {
        const jsonStr = JSON.stringify(data, BufferJSON.replacer);
        await pool.query(
          `INSERT INTO whatsapp_auth_states (establishment_id, key_type, key_id, key_data)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (establishment_id, key_type, key_id) 
           DO UPDATE SET key_data = EXCLUDED.key_data`,
          [establishmentId, type, id, jsonStr]
        );
      }
    } catch (err) {
      console.error(`Postgres auth write key error for ${type}-${id}:`, err);
    }
  };

  // Load or initialize credentials
  let creds = await readKey('creds', 'current');
  if (!creds) {
    creds = initAuthCreds();
    await writeKey('creds', 'current', creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: { [id: string]: any } = {};
          await Promise.all(
            ids.map(async (id) => {
              let val = await readKey(type, id);
              if (type === 'app-state-sync-key' && val) {
                val = proto.Message.AppStateSyncKeyData.fromObject(val);
              }
              data[id] = val;
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
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
