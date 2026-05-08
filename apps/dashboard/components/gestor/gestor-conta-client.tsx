'use client'
// gestor-conta-client.tsx — Conta e integrações do gestor
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type CalendarStatus, type Setting } from '../../lib/api'
import { gestorLogoutAction } from '../../app/gestor/actions'
import { Calendar, CheckCircle, XCircle, Lock, Loader2 } from 'lucide-react'

interface Props {
  tenantId: string
  calendarStatus: CalendarStatus | null
  settings: Setting[]
}

export function GestorContaClient({ tenantId, calendarStatus, settings }: Props): JSX.Element {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const passwordMutation = useMutation({
    mutationFn: () =>
      api.updateConfigSection(
        'account',
        { gestor_password: newPassword },
        tenantId
      ),
    onSuccess: () => {
      setPasswordMsg({ ok: true, text: 'Senha alterada com sucesso.' })
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: () => setPasswordMsg({ ok: false, text: 'Erro ao alterar senha.' })
  })

  function handleChangePassword(): void {
    if (!newPassword || newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: 'As senhas não coincidem.' })
      return
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ ok: false, text: 'Senha deve ter pelo menos 6 caracteres.' })
      return
    }
    setPasswordMsg(null)
    passwordMutation.mutate()
  }

  const calendarConnected = calendarStatus?.connected ?? false

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-white text-xl font-semibold">Conta</h1>
        <p className="text-white/40 text-sm mt-0.5">Integrações e configurações do painel</p>
      </div>

      {/* Google Calendar */}
      <div className="bg-white/5 border border-white/8 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <Calendar size={18} className="text-white/60" />
          <span className="text-white font-medium text-sm">Google Calendar</span>
        </div>
        {calendarConnected ? (
          <div className="flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle size={15} />
            <span>Conectado{calendarStatus?.account_email ? ` como ${calendarStatus.account_email}` : ''}</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <XCircle size={15} />
              <span>Não conectado</span>
            </div>
            <p className="text-white/30 text-xs">
              Para conectar o Google Calendar, solicite ao administrador do sistema.
            </p>
          </div>
        )}
      </div>

      {/* Alterar senha */}
      <div className="bg-white/5 border border-white/8 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Lock size={18} className="text-white/60" />
          <span className="text-white font-medium text-sm">Alterar senha do painel</span>
        </div>

        <div className="space-y-3">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Nova senha"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirmar nova senha"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
          />

          {passwordMsg && (
            <p className={`text-sm ${passwordMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {passwordMsg.text}
            </p>
          )}

          <button
            onClick={handleChangePassword}
            disabled={!newPassword || passwordMutation.isPending}
            className="flex items-center gap-2 bg-white text-black text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-white/90 transition-colors disabled:opacity-40"
          >
            {passwordMutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Salvar senha
          </button>
        </div>
      </div>

      {/* Tenant info */}
      <div className="bg-white/5 border border-white/8 rounded-2xl p-5">
        <p className="text-white/40 text-xs uppercase tracking-wider mb-3">ID da empresa</p>
        <p className="text-white font-mono text-sm">{tenantId}</p>
      </div>

      {/* Logout */}
      <form action={gestorLogoutAction}>
        <button
          type="submit"
          className="w-full text-white/40 text-sm hover:text-red-400 transition-colors py-2"
        >
          Sair do painel
        </button>
      </form>
    </div>
  )
}
