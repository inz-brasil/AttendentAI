// app-shell.tsx — Shell principal com sidebar, header e área de conteúdo
import type { ReactNode } from 'react'
import Link from 'next/link'
import { logoutAction } from '../app/actions'

type NavIconProps = {
  className?: string
}

function HomeIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 9.5V20h11V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  )
}

function LeadsIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M2.8 20a5.9 5.9 0 0 1 11.4 0" />
      <path d="M16.5 10.5a3 3 0 1 0-1.2-5.75" />
      <path d="M15.5 14.5a5.2 5.2 0 0 1 5.7 4.8" />
    </svg>
  )
}

function ConversationsIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 6.5h14v9.2H8.8L5 19.5v-13Z" />
      <path d="M8 10h8" />
      <path d="M8 13h5.5" />
    </svg>
  )
}

function AgentsIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3.5v3.5M14 3.5v3.5M10 17v3.5M14 17v3.5M3.5 10h3.5M3.5 14h3.5M17 10h3.5M17 14h3.5" />
      <path d="M10 12h4" />
    </svg>
  )
}

function SkillsIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3.5 13.9 8l4.6 1.9-4.6 1.9L12 16.5 10.1 12 5.5 10.1 10.1 8 12 3.5Z" />
      <path d="M18 14.5 19 17l2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
    </svg>
  )
}

function VaultIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3.8 7.5h6l1.7 2h8.7v9.2a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8V7.5Z" />
      <path d="M3.8 7.5V5.3h5.4l1.7 2.2" />
      <path d="M9 15.5h6" />
    </svg>
  )
}

function PlaygroundIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="m8 10 2.5 2L8 14" />
      <path d="M13 14h3.5" />
    </svg>
  )
}

function SettingsIcon({ className }: NavIconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="M18.7 13.5a7.2 7.2 0 0 0 0-3l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-2.6-1.5L13.4 2h-4l-.3 3a7.5 7.5 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.2 7.2 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.3 3h4l.3-3a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z" />
    </svg>
  )
}

const navItems = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/leads', label: 'Leads', icon: LeadsIcon },
  { href: '/conversations', label: 'Conversas', icon: ConversationsIcon },
  { href: '/agents', label: 'Agentes', icon: AgentsIcon },
  { href: '/skills', label: 'Skills', icon: SkillsIcon },
  { href: '/vault', label: 'Vault', icon: VaultIcon },
  { href: '/playground', label: 'Playground', icon: PlaygroundIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon }
]

/**
 * Renderiza o layout operacional do dashboard.
 * @param props Conteúdo da página.
 * @returns Shell visual do dashboard.
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-line bg-panel/95 px-4 py-5 lg:block">
        <Link href="/" className="focus-ring block rounded-md px-2 py-1">
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">AttendentAI</div>
          <div className="mt-2 text-xl font-semibold tracking-tight">Operations Console</div>
        </Link>

        <nav className="mt-8 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="focus-ring group flex h-11 items-center gap-3 rounded-md px-3 text-sm text-muted transition hover:bg-elevated hover:text-ink"
              >
                <span className="grid h-8 w-8 place-items-center rounded bg-canvas text-cyan shadow-panel transition group-hover:text-accent">
                  <Icon className="h-4 w-4" />
                </span>
                <span>{item.label}</span>
              </Link>
            )
          })}
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
