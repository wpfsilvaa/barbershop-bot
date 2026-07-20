import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

let wss: WebSocketServer | null = null;
const clients = new Map<string, Set<WebSocket>>();

export function initializeWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let userEstId: string | null = null;

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'auth' && data.establishmentId) {
          userEstId = data.establishmentId;
          if (!clients.has(userEstId!)) {
            clients.set(userEstId!, new Set());
          }
          clients.get(userEstId!)!.add(ws);
          console.log(`[WS] Client authenticated for establishment ${userEstId}`);
        }
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    });

    ws.on('close', () => {
      if (userEstId && clients.has(userEstId)) {
        clients.get(userEstId)!.delete(ws);
        if (clients.get(userEstId)!.size === 0) {
          clients.delete(userEstId);
        }
      }
      console.log('[WS] Client disconnected');
    });
  });

  console.log('[WS] WebSocket Server initialized successfully.');
}

export function broadcastToEstablishment(establishmentId: string, payload: any) {
  const targetClients = clients.get(establishmentId);
  if (targetClients) {
    const dataStr = JSON.stringify(payload);
    for (const ws of targetClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(dataStr);
      }
    }
  }
}
