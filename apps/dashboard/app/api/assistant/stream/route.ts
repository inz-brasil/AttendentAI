// route.ts — SSE local para streaming visual do assistente interno no dashboard
import { NextResponse } from 'next/server'

const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface ChatBody {
  message?: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  files?: Array<{ name: string; content: string }>
}

function encodeSse(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

/**
 * Faz proxy do playground e devolve chunks SSE para a UI.
 * @param request Requisição com mensagem e histórico.
 * @returns Stream SSE.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json() as ChatBody
  const fileContext = (body.files ?? [])
    .map((file) => `\n\n[Arquivo: ${file.name}]\n${file.content}`)
    .join('')

  const response = await fetch(`${apiUrl}/api/playground/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `${body.message ?? ''}${fileContext}`,
      phone: 'internal_dashboard',
      agentId: 'internal-assistant',
      history: body.history ?? []
    })
  })

  if (!response.ok) {
    return NextResponse.json({ error: 'assistant_stream_failed' }, { status: 502 })
  }

  const payload = await response.json() as { response?: string; debug?: Record<string, unknown> }
  const words = String(payload.response ?? '').split(/(\s+)/).filter(Boolean)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encodeSse({ type: 'status', value: 'started' }))
      for (const word of words) {
        controller.enqueue(encodeSse({ type: 'token', value: word }))
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      controller.enqueue(encodeSse({ type: 'done', debug: payload.debug ?? {} }))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  })
}
