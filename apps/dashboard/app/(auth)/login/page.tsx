// page.tsx — Tela de login por senha única do dashboard
import { loginAction } from '../../actions'

/**
 * Renderiza formulário de login.
 * @param props Search params da rota.
 * @returns Página de login.
 */
export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }): JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
      <section className="w-full max-w-md rounded-lg bg-panel p-8 shadow-panel">
        <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent">AttendentAI</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Acesso ao console</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Entre com a senha operacional para acessar leads, agentes, skills e vault.
        </p>

        <form action={loginAction} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-ink">Senha</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              className="focus-ring mt-2 h-11 w-full rounded-md bg-canvas px-3 text-sm text-ink shadow-panel outline-none"
              required
            />
          </label>

          {searchParams?.error ? (
            <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">Senha inválida.</div>
          ) : null}

          <button className="focus-ring h-11 w-full rounded-md bg-accent px-4 text-sm font-semibold text-canvas transition hover:bg-[#e7ef58]">
            Entrar
          </button>
        </form>
      </section>
    </main>
  )
}
