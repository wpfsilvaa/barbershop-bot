import Redis from 'ioredis';

/**
 * Broker único de eventos de chat para o SSE.
 *
 * Antes, cada requisição em `/bot/chats/sse` abria uma conexão Redis nova e só a
 * fechava no `close` do request. Como o navegador reabre o EventSource
 * automaticamente, bastava um cliente instável (ou um atacante autenticado
 * abrindo requisições em série) para esgotar o limite de conexões do Redis e
 * derrubar as filas do WhatsApp junto. Agora existe UM subscriber para o processo
 * inteiro e os assinantes são callbacks em memória.
 */

const CHANNEL = 'whatsapp-chat-updates';

type Listener = (payload: any) => void;

const listeners = new Set<Listener>();
let subscriber: Redis | null = null;

export function ensureSubscriber() {
  if (subscriber) return;

  subscriber = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  subscriber.on('error', (err) => {
    console.error('[ChatEvents] Redis subscriber error:', err.message);
  });

  subscriber.subscribe(CHANNEL).catch((err) => {
    console.error('[ChatEvents] Failed to subscribe to chat updates channel:', err.message);
  });

  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;

    let payload: any;
    try {
      payload = JSON.parse(message);
    } catch {
      return; // Mensagem malformada no canal: ignora.
    }

    if (payload?.establishmentId) {
      try {
        const { broadcastToEstablishment } = require('./wsServer');
        broadcastToEstablishment(payload.establishmentId, payload);
      } catch (err) {
        console.error('[ChatEvents] Failed to broadcast payload via WS:', err);
      }
    }

    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('[ChatEvents] Listener threw:', err);
      }
    }
  });
}

/** Registra um assinante e devolve a função de cancelamento. */
export function subscribeToChatUpdates(listener: Listener): () => void {
  ensureSubscriber();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function activeChatSubscribers(): number {
  return listeners.size;
}
