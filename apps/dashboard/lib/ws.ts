// ws.ts — Cliente WebSocket com reconexão para atualizações ao vivo
'use client'

import { useEffect, useRef, useState } from 'react'

export type WebSocketStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface LiveEvent {
  type: string
  [key: string]: unknown
}

function getWsUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL || inferApiHost()
  const url = new URL(path, base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function inferApiHost(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3001'
  }

  const url = new URL(window.location.href)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.port = '3001'
    return url.origin
  }

  // EasyPanel usa um host por serviço. Sem NEXT_PUBLIC_API_URL no bundle,
  // inferimos a API a partir do domínio público do dashboard.
  url.hostname = url.hostname
    .replace(/^attendentai-/, 'attendentai-api-')
    .replace('attendentai-dashboard', 'attendentai-api')

  return url.origin
}

export class LiveWebSocketClient {
  private socket: WebSocket | null = null
  private retries = 0
  private closedByUser = false

  constructor(
    private readonly path: string,
    private readonly onMessage: (event: LiveEvent) => void,
    private readonly onStatus: (status: WebSocketStatus) => void
  ) {}

  /**
   * Abre conexão WebSocket.
   * @returns Nada.
   */
  connect(): void {
    this.closedByUser = false
    this.onStatus('connecting')
    this.socket = new WebSocket(getWsUrl(this.path))

    this.socket.onopen = () => {
      this.retries = 0
      this.onStatus('open')
    }

    this.socket.onmessage = (message) => {
      try {
        this.onMessage(JSON.parse(String(message.data)) as LiveEvent)
      } catch {
        this.onMessage({ type: 'raw', data: message.data })
      }
    }

    this.socket.onerror = () => {
      this.onStatus('error')
    }

    this.socket.onclose = () => {
      this.onStatus('closed')
      if (!this.closedByUser) {
        this.scheduleReconnect()
      }
    }
  }

  /**
   * Fecha conexão WebSocket.
   * @returns Nada.
   */
  close(): void {
    this.closedByUser = true
    this.socket?.close()
  }

  private scheduleReconnect(): void {
    this.retries += 1
    const delay = Math.min(1000 * 2 ** this.retries, 15000)
    window.setTimeout(() => this.connect(), delay)
  }
}

/**
 * Hook React para consumir eventos WebSocket.
 * @param path Caminho do endpoint WebSocket.
 * @returns Estado de conexão e último evento recebido.
 */
export function useWebSocket(path = '/api/live'): { status: WebSocketStatus; lastEvent: LiveEvent | null } {
  const [status, setStatus] = useState<WebSocketStatus>('idle')
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)
  const clientRef = useRef<LiveWebSocketClient | null>(null)

  useEffect(() => {
    const client = new LiveWebSocketClient(path, setLastEvent, setStatus)
    clientRef.current = client
    client.connect()

    return () => {
      client.close()
      clientRef.current = null
    }
  }, [path])

  return { status, lastEvent }
}
