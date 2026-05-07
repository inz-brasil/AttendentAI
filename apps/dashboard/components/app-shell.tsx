// app-shell.tsx — Shell responsivo com sidebar colapsável, tema, idioma e debug mode
'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { languages } from '../lib/i18n'
import { useUiStore, type LanguageCode, type ThemeMode } from '../lib/ui-store'

interface NavItem {
  href: string
  key: string
  icon: string
  debugOnly?: boolean
}

const navItems: NavItem[] = [
  { href: '/', key: 'home', icon: '🏠' },
  { href: '/assistant', key: 'assistant', icon: '💬' },
  { href: '/leads', key: 'clients', icon: '👥' },
  { href: '/agents', key: 'agents', icon: '🤖' },
  { href: '/skills', key: 'knowledge', icon: '📚' },
  { href: '/traces', key: 'analytics', icon: '📊' },
  { href: '/settings', key: 'settings', icon: '⚙️' },
  { href: '/debug', key: 'debug', icon: '🐛', debugOnly: true }
]

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function MenuGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function CloseGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { t } = useTranslation()
  const pathname = usePathname()
  const debugMode = useUiStore((state) => state.debugMode)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const setDebugMode = useUiStore((state) => state.setDebugMode)
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
          {sidebarCollapsed ? '›' : '‹'}
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
              <span className="grid h-8 w-8 shrink-0 place-items-center text-base" aria-hidden="true">{item.icon}</span>
              {!sidebarCollapsed && <span className="truncate">{t(`nav.${item.key}`)}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto space-y-3 px-1 pb-2">
        <label className={[
          'flex min-h-11 items-center gap-3 rounded-xl border border-line bg-panel px-3 text-sm text-ink shadow-panel',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        ].join(' ')}
        >
          {!sidebarCollapsed && <span>{t('shell.debugMode')}</span>}
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(event) => setDebugMode(event.target.checked)}
            className="h-5 w-5 accent-[var(--accent)]"
          />
        </label>
      </div>
    </div>
  )
}

function HeaderControls(): JSX.Element {
  const { t, i18n } = useTranslation()
  const theme = useUiStore((state) => state.theme)
  const language = useUiStore((state) => state.language)
  const setTheme = useUiStore((state) => state.setTheme)
  const setLanguage = useUiStore((state) => state.setLanguage)

  function toggleTheme(): void {
    setTheme((theme === 'dark' ? 'light' : 'dark') as ThemeMode)
  }

  function changeLanguage(value: string): void {
    const nextLanguage = value as LanguageCode
    setLanguage(nextLanguage)
    void i18n.changeLanguage(nextLanguage)
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={language}
        onChange={(event) => changeLanguage(event.target.value)}
        aria-label={t('common.language')}
        className="focus-ring h-11 rounded-xl border border-line bg-panel px-3 text-sm text-ink shadow-panel"
      >
        {languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
      </select>
      <button
        type="button"
        onClick={toggleTheme}
        className="focus-ring grid h-11 w-11 place-items-center rounded-xl border border-line bg-panel text-lg shadow-panel"
        aria-label={t('common.theme')}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
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
        <header className="sticky top-0 z-10 border-b border-line bg-canvas/88 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-5 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-panel text-ink shadow-panel lg:hidden"
                    aria-label={t('shell.openMenu')}
                  >
                    <MenuGlyph />
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
                          <CloseGlyph />
                        </button>
                      </Dialog.Close>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              <div className="min-w-0">
                <div className="truncate text-xs text-muted">{t('app.platform')}</div>
                <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{t('app.name')}</h1>
              </div>
            </div>
            <HeaderControls />
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl overflow-x-hidden px-4 py-5 sm:px-5 lg:px-8 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
