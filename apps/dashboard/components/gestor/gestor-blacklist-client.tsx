'use client'
// gestor-blacklist-client.tsx — Gestão de blacklist do tenant no painel do gestor
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type BlacklistEntry } from '../../lib/api'
import { ShieldOff, Plus, Trash2, Loader2 } from 'lucide-react'

interface Props {
  tenantId: string
  initialItems: BlacklistEntry[]
}

export function GestorBlacklistClient({ tenantId, initialItems }: Props): JSX.Element {
  const queryClient = useQueryClient()
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('')

  const query = useQuery({
    queryKey: ['gestor', tenantId, 'blacklist'],
    queryFn: () => api.blacklist(tenantId),
    initialData: { items: initialItems }
  })

  const addMutation = useMutation({
    mutationFn: () =>
      api.addBlacklist({
        tenant_id: tenantId,
        phone: phone.trim(),
        reason: reason.trim() || undefined,
        duration_minutes: duration ? parseInt(duration, 10) : null
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gestor', tenantId, 'blacklist'] })
      setPhone('')
      setReason('')
      setDuration('')
    }
  })

  const removeMutation = useMutation({
    mutationFn: (p: string) => api.removeBlacklist(p, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gestor', tenantId, 'blacklist'] })
    }
  })

  const items = query.data?.items ?? []

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-white text-xl font-semibold">Blacklist</h1>
        <p className="text-white/40 text-sm mt-0.5">{items.length} números bloqueados</p>
      </div>

      {/* Formulário */}
      <div className="bg-white/5 border border-white/8 rounded-2xl p-5 space-y-3">
        <p className="text-white/60 text-sm font-medium">Adicionar número</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Telefone (ex: 5511999...)"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (opcional)"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="Duração em minutos (vazio = permanente)"
            type="number"
            min="1"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
          />
          <button
            onClick={() => addMutation.mutate()}
            disabled={!phone.trim() || addMutation.isPending}
            className="flex items-center gap-2 bg-white text-black text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-white/90 transition-colors disabled:opacity-40"
          >
            {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Bloquear
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white/5 border border-white/8 rounded-2xl">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-white/25">
            <ShieldOff size={28} className="mb-3 opacity-50" />
            <p className="text-sm">Nenhum número bloqueado</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {items.map((item) => (
              <div key={item.phone} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{item.phone}</p>
                  {item.reason && <p className="text-white/40 text-xs truncate mt-0.5">{item.reason}</p>}
                  {item.expires_at && (
                    <p className="text-white/25 text-xs mt-0.5">
                      Expira: {new Date(item.expires_at).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removeMutation.mutate(item.phone)}
                  disabled={removeMutation.isPending}
                  className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
