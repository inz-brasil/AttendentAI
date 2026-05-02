// ws.ts — Cliente WebSocket com reconexão para atualizações ao vivo
'use client'

import { useEffect, useRef, useState } from 'react'

export type WebSocketStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface LiveEvent {
  type: string
  [key: string]: unknown
}

function getWsUrl(path: string): string {
  const inferredApiHost =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//api-${window.location.host}`
      : 'http://localhost:3001'
  const base = process.env.NEXT_PUBLIC_API_URL || inferredApiHost
  const url = new URL(path, base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
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
