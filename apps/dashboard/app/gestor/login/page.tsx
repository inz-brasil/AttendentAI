// page.tsx — Página de login do painel do gestor
import { gestorLoginAction } from '../actions'

interface Props {
  searchParams: { error?: string; next?: string }
}

export default function GestorLoginPage({ searchParams }: Props): JSX.Element {
  const hasError = searchParams.error === '1'

  return (
    <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="text-white text-xl font-semibold">AttendentAI</h1>
          <p className="text-white/40 text-sm mt-1">Painel do Gestor</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <form action={gestorLoginAction} className="space-y-4">
            {hasError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-red-400 text-sm">
                Credenciais inválidas. Tente novamente.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-white/60 text-xs font-medium uppercase tracking-wider">
                ID da empresa
              </label>
              <input
                name="tenant_id"
                type="text"
                required
                autoComplete="username"
                placeholder="ex: minha_empresa"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 focus:bg-white/8 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-white/60 text-xs font-medium uppercase tracking-wider">
                Senha
              </label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/20 text-sm focus:outline-none focus:border-white/30 focus:bg-white/8 transition-colors"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-white text-black font-medium rounded-xl py-2.5 text-sm hover:bg-white/90 transition-colors mt-2"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
