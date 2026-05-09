// server.ts — Servidor WebSocket para broadcast de eventos em tempo real
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from '@fastify/websocket'

/** Conjunto de clientes WS conectados */
const clients = new Set<WebSocket>()

export interface WsEvent {
  type: 'new_message' | 'agent_status' | 'system' | 'history_cleared'
  phone?: string
  name?: string
  message?: string
  response?: string
  agent?: string
  intent?: string
  timestamp: string
  [key: string]: unknown
}

/**
 * Faz broadcast de um evento para todos os clientes WebSocket conectados.
 * @param event Objeto de evento serializado como JSON.
 * @returns Nada.
 */
export function broadcast(event: WsEvent): void {
  const payload = JSON.stringify(event)
  for (const client of clients) {
    // readyState 1 === OPEN
    if (client.readyState === 1) {
      client.send(payload)
    }
  }
}

/**
 * Registra o endpoint WebSocket /ws no servidor Fastify.
 * @param app Instância Fastify com plugin websocket registrado.
 * @returns Nada.
 */
export async function registerWebSocketServer(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket)
    app.log.info({ clients: clients.size }, 'ws client connected')

    // Envia evento de boas-vindas com status do servidor
    socket.send(JSON.stringify({
      type: 'system',
      message: 'connected',
      clients: clients.size,
      timestamp: new Date().toISOString()
    }))

    socket.on('close', () => {
      clients.delete(socket)
      app.log.info({ clients: clients.size }, 'ws client disconnected')
    })

    socket.on('error', (err: Error) => {
      app.log.warn({ err }, 'ws client error')
      clients.delete(socket)
    })
  })
}
