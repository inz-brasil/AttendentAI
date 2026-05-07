// assistant-client.tsx — Chat do assistente interno com stream, sessões e upload
'use client'

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface AttachedFile {
  name: string
  content: string
}

function newId(): string {
  return crypto.randomUUID()
}

function parseSseChunk(chunk: string): Array<Record<string, unknown>> {
  return chunk
    .split('\n\n')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('data: '))
    .map((part) => JSON.parse(part.slice(6)) as Record<string, unknown>)
}

/**
 * Interface de chat do assistente interno.
 * @returns Chat operacional responsivo.
 */
export function AssistantClient(): JSX.Element {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [streaming, setStreaming] = useState(false)
  const [webSearching, setWebSearching] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const history = useMemo(() => messages.map((message) => ({
    role: message.role,
    content: message.content
  })), [messages])

  async function handleFiles(fileList: FileList | null): Promise<void> {
    if (!fileList) return
    const loaded: AttachedFile[] = []
    for (const file of Array.from(fileList)) {
      loaded.push({ name: file.name, content: await file.text() })
    }
    setFiles((current) => [...current, ...loaded])
  }

  async function sendMessage(): Promise<void> {
    const text = input.trim()
    if (!text || streaming) return

    const userMessage: ChatMessage = { id: newId(), role: 'user', content: text }
    const assistantId = newId()
    setMessages((current) => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)
    setWebSearching(/\b(busca|pesquisa|noticia|internet|web|search)\b/i.test(text))

    try {
      const response = await fetch('/api/assistant/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, files })
      })
      if (!response.ok || !response.body) throw new Error('stream_failed')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const result = await reader.read()
        if (result.done) break
        buffer += decoder.decode(result.value, { stream: true })
        const events = parseSseChunk(buffer)
        buffer = buffer.endsWith('\n\n') ? '' : buffer.slice(buffer.lastIndexOf('\n\n') + 2)
        for (const event of events) {
          if (event.type === 'token' && typeof event.value === 'string') {
            setMessages((current) => current.map((message) =>
              message.id === assistantId ? { ...message, content: `${message.content}${event.value}` } : message
            ))
          }
        }
      }
      setFiles([])
    } catch {
      setMessages((current) => current.map((message) =>
        message.id === assistantId ? { ...message, content: t('assistant.streamError') } : message
      ))
    } finally {
      setStreaming(false)
      setWebSearching(false)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-7rem)] gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="surface flex min-h-[68vh] flex-col overflow-hidden rounded-2xl">
        <header className="border-b border-line px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{t('assistant.eyebrow')}</div>
          <h2 className="mt-2 text-2xl font-semibold">{t('assistant.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('assistant.subtitle')}</p>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center py-16 text-center text-sm text-muted">
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-elevated text-xl">💬</div>
              {t('assistant.empty')}
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={[
                'max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[74%]',
                message.role === 'user' ? 'bg-accent text-[var(--accent-contrast)]' : 'bg-elevated text-ink'
              ].join(' ')}
              >
                {message.content || (message.role === 'assistant' ? t('assistant.thinking') : '')}
              </div>
            </div>
          ))}
        </div>

        <footer className="border-t border-line p-3">
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((file) => (
                <span key={file.name} className="rounded-full bg-elevated px-3 py-1 text-xs text-muted">
                  {file.name} · {t('assistant.uploadReady')}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-panel">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-elevated"
              aria-label={t('assistant.upload')}
            >
              +
            </button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
              rows={1}
              className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none"
              placeholder={t('assistant.inputPlaceholder')}
            />
            <button
              type="button"
              disabled={streaming || !input.trim()}
              onClick={() => void sendMessage()}
              className="focus-ring min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50"
            >
              {t('common.send')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void handleFiles(event.target.files)}
            />
          </div>
        </footer>
      </section>

      <aside className="space-y-4">
        <div className="surface rounded-2xl p-4">
          <div className="text-sm font-semibold">{t('assistant.history')}</div>
          <button
            type="button"
            onClick={() => {
              setMessages([])
              setFiles([])
            }}
            className="focus-ring mt-3 w-full rounded-xl bg-elevated px-3 py-2 text-left text-sm"
          >
            {t('common.newConversation')}
          </button>
        </div>
        <div className="surface rounded-2xl p-4">
          <div className="text-sm font-semibold">{t('assistant.webSearch')}</div>
          <div className="mt-3 flex min-h-11 items-center justify-between rounded-xl bg-elevated px-3 text-sm text-muted">
            <span>{webSearching ? t('assistant.searching') : t('common.inactive')}</span>
            <span className={webSearching ? 'text-success' : 'text-muted'}>●</span>
          </div>
        </div>
      </aside>
    </div>
  )
}
