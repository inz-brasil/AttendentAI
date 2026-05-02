// app-shell.tsx — Shell principal com sidebar, header e área de conteúdo
import Link from 'next/link'
import { logoutAction } from '../app/actions'

const navItems = [
  { href: '/', label: 'Home', marker: 'HM' },
  { href: '/leads', label: 'Leads', marker: 'LD' },
  { href: '/conversations', label: 'Conversas', marker: 'CV' },
  { href: '/agents', label: 'Agentes', marker: 'AG' },
  { href: '/skills', label: 'Skills', marker: 'SK' },
  { href: '/vault', label: 'Vault', marker: 'VT' },
  { href: '/playground', label: 'Playground', marker: 'PG' },
  { href: '/settings', label: 'Settings', marker: 'ST' }
]

/**
 * Renderiza o layout operacional do dashboard.
 * @param props Conteúdo da página.
 * @returns Shell visual do dashboard.
 */
export function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-line bg-panel/95 px-4 py-5 lg:block">
        <Link href="/" className="focus-ring block rounded-md px-2 py-1">
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">AttendentAI</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">Operations Console</div>
        </Link>

        <nav className="mt-8 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="focus-ring group flex h-11 items-center gap-3 rounded-md px-3 text-sm text-muted transition hover:bg-elevated hover:text-ink"
            >
              <span className="grid h-7 w-8 place-items-center rounded bg-canvas font-mono text-[11px] text-cyan shadow-panel">
                {item.marker}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-5 left-4 right-4 rounded-lg bg-canvas p-4 shadow-panel">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Status</div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-ink">Core API</span>
            <span className="rounded-full bg-success/15 px-2 py-1 font-mono text-xs text-success">ready</span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-5 lg:px-8">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">WhatsApp Agent Platform</div>
              <h1 className="text-lg font-semibold tracking-tight">AttendentAI</h1>
            </div>
            <form action={logoutAction}>
              <button className="focus-ring h-9 rounded-md bg-accent px-4 text-sm font-semibold text-canvas transition hover:bg-[#e7ef58]">
                Logout
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
