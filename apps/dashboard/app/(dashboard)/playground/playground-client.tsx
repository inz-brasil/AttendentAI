'use client'
// playground-client.tsx — Interface chat de testes com debug panel multiagente
import { useState, useRef, useEffect, useCallback } from 'react'
import { Badge } from '../../../components/ui/badge'
import { useToast } from '../../../components/ui/toast-provider'
import type { Agent, Lead } from '../../../lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface DebugInfo {
  classification: Record<string, unknown>
  agents_called: string[]
  tokens_by_agent: Record<string, number>
  total_tokens: number
  total_ms: number
  system_prompt: string
  agent: { id: string; name: string; model: string | null; temperature: number | null }
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  debug?: DebugInfo
}

interface PlaygroundClientProps {
  agents: Agent[]
  leads: Lead[]
}

/**
 * Interface de chat de testes com debug panel por mensagem.
 * @param props Agentes e leads disponíveis.
 * @returns Playground de testes.
 */
export function PlaygroundClient({ agents, leads }: PlaygroundClientProps): JSX.Element {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id ?? 'responder')
  const [phoneMode, setPhoneMode] = useState<'custom' | 'lead'>('custom')
  const [customPhone, setCustomPhone] = useState('playground_test_001')
  const [selectedLead, setSelectedLead] = useState(leads[0]?.phone ?? '')
  const [showDebug, setShowDebug] = useState(true)
  const [expandedSystemPrompt, setExpandedSystemPrompt] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const activePhone = phoneMode === 'lead' ? `playground_${selectedLead}` : customPhone
  const sourceLeadPhone = phoneMode === 'lead' ? selectedLead : undefined

  // Auto-scroll para o final
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending) return
    const content = input.trim()
    setInput('')
    setSending(true)

    // Adiciona mensagem do usuário imediatamente
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, userMsg])

    // Monta histórico (excluindo a mensagem que acabou de ser adicionada)
    const history = messages.map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch(`${API_BASE}/api/playground/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          phone: activePhone,
          sourceLeadPhone,
          agentId: selectedAgent,
          history
        })
      })

      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error)
      }

      const data = await res.json() as { response: string; debug: DebugInfo }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
        debug: data.debug
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      toast({ title: `Erro: ${err instanceof Error ? err.message : 'Falha na requisição'}`, variant: 'danger' })
      // Remove mensagem do usuário se falhou
      setMessages(prev => prev.filter(m => m.id !== userMsg.id))
      setInput(content)
    } finally {
      setSending(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [input, sending, messages, activePhone, sourceLeadPhone, selectedAgent, toast])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  function clearChat() {
    setMessages([])
    setInput('')
    inputRef.current?.focus()
  }

  const selectedAgentObj = agents.find(a => a.id === selectedAgent)

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] gap-0">
      {/* Header / controles */}
      <div className="flex items-center gap-3 pb-4 flex-wrap">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Testes</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Playground</h2>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Seleção de agente */}
          <select
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value)}
            className="h-8 rounded-md border border-line bg-panel px-3 text-xs text-ink outline-none focus:border-cyan transition"
          >
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.model})</option>
            ))}
            {agents.length === 0 && <option value="responder">responder (padrão)</option>}
          </select>

          {/* Toggle debug */}
          <button
            onClick={() => setShowDebug(p => !p)}
            className={`h-8 rounded-md border px-3 text-xs transition ${showDebug ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-elevated text-muted hover:text-ink'}`}
          >
            Debug {showDebug ? '▸' : '▸'}
          </button>

          {/* Limpar */}
          <button
            onClick={clearChat}
            className="h-8 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
          >
            Limpar
          </button>
        </div>
      </div>

      <div className={`flex gap-4 flex-1 min-h-0 ${showDebug ? 'grid grid-cols-[1fr_320px]' : ''}`}>
        {/* Chat principal */}
        <div className="flex flex-col rounded-xl border border-line bg-panel shadow-panel overflow-hidden min-h-0">
          {/* Barra de contexto */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-line bg-panel/80 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPhoneMode('custom')}
                className={`h-6 rounded px-2 text-[11px] font-mono transition ${phoneMode === 'custom' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-ink'}`}
              >
                Phone customizado
              </button>
              <button
                onClick={() => setPhoneMode('lead')}
                className={`h-6 rounded px-2 text-[11px] font-mono transition ${phoneMode === 'lead' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-ink'}`}
              >
                Lead existente
              </button>
            </div>

            {phoneMode === 'custom' ? (
              <input
                value={customPhone}
                onChange={e => setCustomPhone(e.target.value)}
                className="h-6 rounded border border-line bg-canvas px-2 font-mono text-[11px] text-ink outline-none focus:border-cyan transition w-48"
              />
            ) : (
              <select
                value={selectedLead}
                onChange={e => setSelectedLead(e.target.value)}
                className="h-6 rounded border border-line bg-canvas px-2 font-mono text-[11px] text-ink outline-none focus:border-cyan transition"
              >
                {leads.map(l => <option key={l.phone} value={l.phone}>{l.name ?? l.phone} ({l.phone})</option>)}
                {leads.length === 0 && <option value="">Nenhum lead disponível</option>}
              </select>
            )}

            <span className="ml-auto font-mono text-[10px] text-muted/60">
              → {activePhone}
            </span>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="opacity-30">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <div>
                  <p className="text-sm font-medium">Pronto para testar</p>
                  <p className="text-xs text-muted/60 mt-1">
                    Envie uma mensagem para ver o pipeline multiagente em ação.
                  </p>
                  {selectedAgentObj && (
                    <div className="mt-3 rounded-lg border border-line bg-canvas px-3 py-2 inline-flex items-center gap-2">
                      <Badge variant="success">{selectedAgentObj.name}</Badge>
                      <span className="font-mono text-[10px] text-muted">{selectedAgentObj.model} · temp {selectedAgentObj.temperature}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {/* Avatar */}
                <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-mono ${
                  msg.role === 'user'
                    ? 'bg-accent/20 border border-accent/30 text-accent'
                    : 'bg-elevated border border-line text-muted'
                }`}>
                  {msg.role === 'user' ? 'V' : 'AI'}
                </div>

                {/* Bolha */}
                <div className={`flex flex-col max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-accent text-canvas rounded-tr-sm'
                      : 'bg-elevated border border-line text-ink rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                  <span className="mt-1 font-mono text-[9px] text-muted/50">
                    {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    {msg.debug && ` · ${msg.debug.total_ms}ms · ${msg.debug.total_tokens} tokens`}
                  </span>
                </div>
              </div>
            ))}

            {/* Indicador de digitando */}
            {sending && (
              <div className="flex gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevated border border-line text-muted text-[10px] font-mono">AI</div>
                <div className="rounded-2xl rounded-tl-sm bg-elevated border border-line px-4 py-3 flex gap-1.5 items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Campo de entrada */}
          <div className="border-t border-line p-3 bg-panel/80">
            <div className="flex items-end gap-2 rounded-xl border border-line bg-canvas px-3 py-2 focus-within:border-cyan transition">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite uma mensagem… (Enter para enviar, Shift+Enter para nova linha)"
                rows={1}
                disabled={sending}
                className="flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-muted/50 outline-none leading-relaxed"
                style={{ maxHeight: '120px' }}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={sending || !input.trim()}
                className="focus-ring shrink-0 grid h-8 w-8 place-items-center rounded-lg bg-accent text-canvas hover:bg-[#e7ef58] disabled:opacity-40 transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m22 2-7 20-4-9-9-4 20-7z"/>
                </svg>
              </button>
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-muted/50 text-center">
              Enter envia · Shift+Enter nova linha · Dados não são salvos em produção
            </p>
          </div>
        </div>

        {/* Debug panel */}
        {showDebug && (
          <div className="flex flex-col rounded-xl border border-line bg-panel shadow-panel overflow-hidden min-h-0">
            <div className="px-4 py-3 border-b border-line">
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-accent">Debug</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              {messages.filter(m => m.debug).length === 0 ? (
                <p className="text-xs text-muted/60 text-center py-8">
                  Informações de debug aparecerão aqui após cada resposta.
                </p>
              ) : (
                messages.filter(m => m.role === 'assistant' && m.debug).map((msg, i) => {
                  const d = msg.debug!
                  return (
                    <div key={msg.id} className="rounded-lg border border-line bg-canvas p-3 space-y-2.5">
                      <div className="font-mono text-[10px] text-accent uppercase tracking-[0.12em]">
                        Msg #{i + 1} · {d.total_ms}ms
                      </div>

                      {/* Classificação */}
                      <div>
                        <div className="font-mono text-[9px] text-muted/60 mb-1">CLASSIFICAÇÃO</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(d.classification).map(([k, v]) => (
                            <div key={k} className="rounded bg-elevated border border-line px-1.5 py-0.5 font-mono text-[9px]">
                              <span className="text-muted/60">{k}:</span> <span className="text-ink">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Agentes chamados */}
                      <div>
                        <div className="font-mono text-[9px] text-muted/60 mb-1">AGENTES CHAMADOS</div>
                        <div className="flex flex-wrap gap-1">
                          {d.agents_called.map((a, idx) => (
                            <div key={idx} className="flex items-center gap-1 rounded bg-elevated border border-line px-1.5 py-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-success" />
                              <span className="font-mono text-[9px] text-ink">{a}</span>
                              {d.tokens_by_agent[a] !== undefined && (
                                <span className="font-mono text-[9px] text-muted/60">{d.tokens_by_agent[a]}tk</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Tokens */}
                      <div>
                        <div className="font-mono text-[9px] text-muted/60 mb-1">TOKENS</div>
                        <div className="font-mono text-xs text-ink">
                          {d.total_tokens} total
                          <span className="text-muted/60 ml-2">({d.agent.model})</span>
                        </div>
                      </div>

                      {/* System Prompt expandível */}
                      <div>
                        <button
                          onClick={() => setExpandedSystemPrompt(expandedSystemPrompt === msg.id ? null : msg.id)}
                          className="font-mono text-[9px] text-accent hover:underline"
                        >
                          {expandedSystemPrompt === msg.id ? '▾' : '▸'} System Prompt
                        </button>
                        {expandedSystemPrompt === msg.id && (
                          <pre className="mt-1.5 max-h-32 overflow-y-auto rounded bg-elevated border border-line p-2 font-mono text-[9px] text-muted leading-relaxed whitespace-pre-wrap">
                            {d.system_prompt || '(vazio)'}
                          </pre>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
