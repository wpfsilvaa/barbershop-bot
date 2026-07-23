import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt';

/**
 * Servidor WebSocket para atualizações de chat em tempo real.
 *
 * Falha corrigida (crítica): a versão anterior aceitava qualquer conexão anônima e
 * confiava no `establishmentId` enviado pelo próprio cliente. Bastava conectar e
 * mandar `{"type":"auth","establishmentId":"<uuid-de-outra-barbearia>"}` para
 * receber, ao vivo, todas as mensagens de WhatsApp daquele estabelecimento —
 * conversas de clientes, telefones e conteúdo integral. Agora exige um JWT válido
 * e o estabelecimento vem do token, não do payload.
 */

let wss: WebSocketServer | null = null;
const clients = new Map<string, Set<WebSocket>>();

const AUTH_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 4096;

interface TokenPayload {
  id: string;
  establishment_id: string | null;
  role: 'admin' | 'owner' | 'barber' | 'client';
}

export function initializeWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (ws) => {
    let userEstId: string | null = null;
    let authenticated = false;

    // Conexões que não se autenticam em 10s são descartadas, para que sockets
    // ociosos não sirvam de vetor de exaustão de recursos.
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        try {
          ws.close(4401, 'Authentication timeout');
        } catch {
          /* noop */
        }
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (message: Buffer) => {
      if (authenticated) return; // Após autenticar, o canal é somente de saída.

      let data: any;
      try {
        data = JSON.parse(message.toString('utf8'));
      } catch {
        return; // Payload inválido: ignora silenciosamente.
      }

      if (data?.type !== 'auth' || typeof data.token !== 'string') {
        return;
      }

      let payload: TokenPayload;
      try {
        payload = jwt.verify(data.token, JWT_SECRET) as TokenPayload;
      } catch {
        try {
          ws.close(4401, 'Invalid token');
        } catch {
          /* noop */
        }
        return;
      }

      // Clientes finais não têm painel de chat; apenas equipe da barbearia.
      if (!payload.role || payload.role === 'client') {
        try {
          ws.close(4403, 'Forbidden');
        } catch {
          /* noop */
        }
        return;
      }

      // O super admin pode observar um estabelecimento específico; os demais
      // ficam presos ao estabelecimento gravado no próprio token.
      const requested = typeof data.establishmentId === 'string' ? data.establishmentId : null;
      const resolved = payload.role === 'admin' ? requested || payload.establishment_id : payload.establishment_id;

      if (!resolved) {
        try {
          ws.close(4403, 'No establishment bound to this token');
        } catch {
          /* noop */
        }
        return;
      }

      const boundEstId: string = resolved;
      userEstId = boundEstId;
      authenticated = true;
      clearTimeout(authTimer);

      if (!clients.has(boundEstId)) {
        clients.set(boundEstId, new Set());
      }
      clients.get(boundEstId)!.add(ws);

      // Nunca logamos o token nem o payload completo.
      console.log(`[WS] Client authenticated for establishment ${boundEstId} (role: ${payload.role})`);
      ws.send(JSON.stringify({ type: 'auth_ok' }));
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (userEstId && clients.has(userEstId)) {
        const set = clients.get(userEstId)!;
        set.delete(ws);
        if (set.size === 0) {
          clients.delete(userEstId);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Socket error:', err.message);
    });
  });

  console.log('[WS] WebSocket Server initialized successfully.');
}

export function broadcastToEstablishment(establishmentId: string, payload: any) {
  const targetClients = clients.get(establishmentId);
  if (!targetClients) return;

  const dataStr = JSON.stringify(payload);
  for (const ws of targetClients) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(dataStr);
      } catch (err) {
        console.error('[WS] Failed to deliver payload:', err);
      }
    }
  }
}
