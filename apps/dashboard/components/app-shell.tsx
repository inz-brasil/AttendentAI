// app-shell.tsx — Shell responsivo com sidebar colapsável e navegação profissional
'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  BookOpen,
  Bot,
  Bug,
  Home,
  Menu,
  MessageSquare,
  PanelLeftClose,
  Settings,
  Users,
  X,
  type LucideIcon
} from 'lucide-react'
import { useUiStore } from '../lib/ui-store'

interface NavItem {
  href: string
  key: string
  icon: LucideIcon
  debugOnly?: boolean
}

const navItems: NavItem[] = [
  { href: '/', key: 'home', icon: Home },
  { href: '/assistant', key: 'assistant', icon: MessageSquare },
  { href: '/leads', key: 'clients', icon: Users },
  { href: '/agents', key: 'agents', icon: Bot },
  { href: '/skills', key: 'knowledge', icon: BookOpen },
  { href: '/traces', key: 'analytics', icon: BarChart3 },
  { href: '/debug', key: 'debug', icon: Bug, debugOnly: true }
]

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { t } = useTranslation()
  const pathname = usePathname()
  const debugMode = useUiStore((state) => state.debugMode)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const visibleItems = navItems.filter((item) => debugMode || !item.debugOnly)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-2">
        <Link href="/" onClick={onNavigate} className="focus-ring min-w-0 rounded-lg py-1">
          <div className="truncate text-sm font-semibold text-ink">{t('app.name')}</div>
          {!sidebarCollapsed && <div className="mt-0.5 truncate text-xs text-muted">{t('app.tagline')}</div>}
        </Link>
        <button
          type="button"
          className="focus-ring hidden h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-ink lg:grid"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? t('shell.expand') : t('shell.collapse')}
        >
          <PanelLeftClose className={sidebarCollapsed ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} />
        </button>
      </div>

      <nav className="mt-6 space-y-1" aria-label={t('app.platform')}>
        {visibleItems.map((item) => {
          const active = isActivePath(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={[
                'focus-ring group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition',
                active ? 'bg-elevated text-ink shadow-panel' : 'text-muted hover:bg-elevated hover:text-ink',
                sidebarCollapsed ? 'justify-center' : ''
              ].join(' ')}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center" aria-hidden="true">
                <item.icon className="h-4 w-4" strokeWidth={1.8} />
              </span>
              {!sidebarCollapsed && <span className="truncate">{t(`nav.${item.key}`)}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto px-1 pb-2">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={[
            'focus-ring flex min-h-11 items-center gap-3 rounded-xl border border-line bg-panel px-3 text-sm text-muted shadow-panel hover:bg-elevated hover:text-ink',
            sidebarCollapsed ? 'justify-center' : ''
          ].join(' ')}
        >
          <Settings className="h-4 w-4" strokeWidth={1.8} />
          {!sidebarCollapsed && <span>{t('nav.settings')}</span>}
        </Link>
      </div>
    </div>
  )
}

/**
 * Renderiza o layout operacional do dashboard.
 * @param props Conteúdo da página.
 * @returns Shell visual do dashboard.
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside
        className={[
          'fixed inset-y-0 left-0 z-20 hidden border-r border-line bg-panel/95 px-3 py-4 shadow-panel backdrop-blur lg:block',
          sidebarCollapsed ? 'w-20' : 'w-72'
        ].join(' ')}
      >
        <SidebarContent />
      </aside>

      <div className={sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'}>
        <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="focus-ring fixed left-4 top-4 z-30 grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-panel text-ink shadow-panel lg:hidden"
              aria-label={t('shell.openMenu')}
            >
              <Menu className="h-5 w-5" strokeWidth={1.8} />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm lg:hidden" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(22rem,92vw)] flex-col border-r border-line bg-panel px-3 py-4 shadow-2xl outline-none lg:hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <SidebarContent onNavigate={() => setMobileMenuOpen(false)} />
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-canvas text-muted"
                    aria-label={t('shell.closeMenu')}
                  >
                    <X className="h-5 w-5" strokeWidth={1.8} />
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <main className="mx-auto min-h-screen max-w-7xl overflow-x-hidden px-4 py-5 pt-20 sm:px-5 lg:px-8 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
