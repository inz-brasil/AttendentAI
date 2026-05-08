'use client'
// gestor-lead-profile-client.tsx — Perfil individual do lead no painel do gestor
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MessageSquare, Phone, Tag, Clock } from 'lucide-react'
import { type Lead, type MessageEventRow } from '../../lib/api'

interface Props {
  tenantId: string
  lead: Lead
  initialMessages: MessageEventRow[]
}

const statusColors: Record<string, string> = {
  lead_quente: 'bg-red-500/15 text-red-400 border-red-500/20',
  ativo: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  novo: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  convertido: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  inativo: 'bg-white/5 text-white/30 border-white/10'
}

const statusLabels: Record<string, string> = {
  lead_quente: 'Quente',
  ativo: 'Ativo',
  novo: 'Novo',
  convertido: 'Convertido',
  inativo: 'Inativo'
}

export function GestorLeadProfileClient({ tenantId, lead, initialMessages }: Props): JSX.Element {
  const router = useRouter()
  const messages = [...initialMessages].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Back */}
      <div className="flex items-center gap-3">
        <Link
          href="/gestor/leads"
          className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-white text-xl font-semibold">{lead.name ?? lead.phone}</h1>
      </div>

      {/* Info card */}
      <div className="bg-white/5 border border-white/8 rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white/60 text-lg font-semibold">
            {(lead.name ?? lead.phone).charAt(0).toUpperCase()}
          </div>
          {lead.status && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusColors[lead.status] ?? 'bg-white/5 text-white/30 border-white/10'}`}>
              {statusLabels[lead.status] ?? lead.status}
            </span>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2.5 text-white/60">
            <Phone size={14} />
            <span className="text-white">{lead.phone}</span>
          </div>
          {lead.email && (
            <div className="flex items-center gap-2.5 text-white/60">
              <span className="text-xs">@</span>
              <span className="text-white">{lead.email}</span>
            </div>
          )}
          {lead.city && (
            <div className="flex items-center gap-2.5 text-white/60">
              <span className="text-xs">📍</span>
              <span className="text-white">{lead.city}</span>
            </div>
          )}
          {lead.tags && lead.tags.length > 0 && (
            <div className="flex items-start gap-2.5 text-white/60">
              <Tag size={14} className="mt-0.5" />
              <div className="flex flex-wrap gap-1.5">
                {lead.tags.map((tag) => (
                  <span key={tag} className="bg-white/8 text-white/60 text-xs px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          {lead.total_messages != null && (
            <div className="flex items-center gap-2.5 text-white/60">
              <MessageSquare size={14} />
              <span className="text-white/60">{lead.total_messages} mensagens no total</span>
            </div>
          )}
        </div>

        <button
          onClick={() => router.push(`/gestor/conversas/${encodeURIComponent(lead.phone)}`)}
          className="w-full flex items-center justify-center gap-2 bg-white text-black text-sm font-medium py-2.5 rounded-xl hover:bg-white/90 transition-colors"
        >
          <MessageSquare size={15} />
          Abrir conversa
        </button>
      </div>

      {/* Histórico recente */}
      <div className="bg-white/5 border border-white/8 rounded-2xl">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/8 text-white/60 text-sm">
          <Clock size={14} />
          <span className="font-medium">Histórico recente</span>
        </div>
        {messages.length === 0 ? (
          <div className="px-5 py-8 text-center text-white/25 text-sm">Sem mensagens</div>
        ) : (
          <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {messages.slice(0, 20).map((msg) => (
              <div key={msg.id} className="px-5 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium ${msg.role === 'user' ? 'text-blue-400' : msg.role === 'human_agent' ? 'text-emerald-400' : 'text-white/40'}`}>
                    {msg.role === 'user' ? 'Lead' : msg.role === 'human_agent' ? 'Atendente' : 'Bot'}
                  </span>
                  <span className="text-white/20 text-xs">
                    {new Date(msg.created_at).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                </div>
                <p className="text-white/70 text-sm line-clamp-2">{msg.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
