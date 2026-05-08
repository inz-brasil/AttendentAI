'use client'
// gestor-chat-client.tsx — Chat direto do gestor com um lead (envia como human_agent)
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Lead, type MessageEventRow } from '../../lib/api'
import { ArrowLeft, Send, User, Bot, Loader2 } from 'lucide-react'

interface Props {
  tenantId: string
  phone: string
  initialMessages: MessageEventRow[]
  lead: Lead | null
}

function roleBubble(role: string): { bg: string; align: string; label: string } {
  if (role === 'user') return { bg: 'bg-white/8', align: 'justify-start', label: '' }
  if (role === 'human_agent') return { bg: 'bg-blue-600/30 border border-blue-500/30', align: 'justify-end', label: 'Você' }
  return { bg: 'bg-white/5', align: 'justify-end', label: 'Bot' }
}

export function GestorChatClient({ tenantId, phone, initialMessages, lead }: Props): JSX.Element {
  const queryClient = useQueryClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')

  const transcriptQuery = useQuery({
    queryKey: ['gestor', tenantId, 'transcript', phone],
    queryFn: () => api.leadTranscript(phone, tenantId, 150),
    initialData: { messages: initialMessages },
    refetchInterval: 5000
  })

  const sendMutation = useMutation({
    mutationFn: (msg: string) => api.sendMessage(phone, msg, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gestor', tenantId, 'transcript', phone] })
      setText('')
    }
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcriptQuery.data?.messages.length])

  const messages = transcriptQuery.data?.messages ?? []
  const displayName = lead?.name ?? phone

  function handleSend(): void {
    const trimmed = text.trim()
    if (!trimmed || sendMutation.isPending) return
    sendMutation.mutate(trimmed)
  }

  return (
    <div className="h-screen flex flex-col bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/8 bg-[#111111]">
        <Link
          href="/gestor/conversas"
          className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-sm font-medium">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-white text-sm font-medium">{displayName}</p>
          <p className="text-white/30 text-xs">{phone}</p>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5">
        {messages.map((msg) => {
          const { bg, align, label } = roleBubble(msg.role)
          return (
            <div key={msg.id} className={`flex ${align}`}>
              <div className="max-w-[75%]">
                {label && (
                  <p className="text-white/30 text-xs mb-1 text-right">{label}</p>
                )}
                <div className={`${bg} rounded-2xl px-4 py-2.5`}>
                  <p className="text-white/90 text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                  <p className="text-white/25 text-xs mt-1">
                    {msg.created_at
                      ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-white/8 bg-[#111111]">
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 focus-within:border-white/20 transition-colors">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Mensagem como atendente humano..."
              rows={1}
              className="w-full bg-transparent text-white text-sm placeholder-white/25 focus:outline-none resize-none max-h-32"
              style={{ height: 'auto' }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
            className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0 disabled:opacity-30 hover:bg-white/90 transition-colors"
          >
            {sendMutation.isPending ? (
              <Loader2 size={15} className="text-black animate-spin" />
            ) : (
              <Send size={15} className="text-black" />
            )}
          </button>
        </div>
        <p className="text-white/20 text-xs mt-2 px-1">Enter para enviar · Shift+Enter para nova linha</p>
      </div>
    </div>
  )
}
