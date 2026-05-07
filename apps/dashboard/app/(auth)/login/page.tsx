// page.tsx — Tela de login por senha única do dashboard
import { LockKeyhole } from 'lucide-react'
import { loginAction } from '../../actions'

/**
 * Renderiza formulário de login.
 * @param props Search params da rota.
 * @returns Página de login.
 */
export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }): JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
      <section className="w-full max-w-[25rem]">
        <div className="mb-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-line bg-panel shadow-panel">
            <LockKeyhole className="h-5 w-5 text-muted" strokeWidth={1.8} />
          </div>
          <div className="mt-5 text-sm font-semibold text-ink">AttendentAI</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Acesso ao console</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Entre para gerenciar atendimento, agentes, empresas e integrações.
          </p>
        </div>

        <form action={loginAction} className="surface space-y-4 rounded-2xl p-5">
          <label className="block">
            <span className="text-sm font-medium text-ink">Senha</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              className="field-input mt-2"
              required
            />
          </label>

          {searchParams?.error ? (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">Senha inválida.</div>
          ) : null}

          <button className="save-btn w-full">
            Entrar
          </button>
        </form>
      </section>
    </main>
  )
}
