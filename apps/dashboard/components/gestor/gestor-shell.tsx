'use client'
// gestor-shell.tsx — Shell do painel do gestor: sidebar + header clean
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { gestorLogoutAction } from '../../app/gestor/actions'
import {
  Home,
  MessageSquare,
  Users,
  ShieldOff,
  Settings,
  LogOut,
  Menu,
  X,
  Bot
} from 'lucide-react'

interface NavItem {
  href: string
  icon: React.ElementType
  label: string
}

const navItems: NavItem[] = [
  { href: '/gestor', icon: Home, label: 'Início' },
  { href: '/gestor/conversas', icon: MessageSquare, label: 'Conversas' },
  { href: '/gestor/leads', icon: Users, label: 'Leads' },
  { href: '/gestor/blacklist', icon: ShieldOff, label: 'Blacklist' },
  { href: '/gestor/conta', icon: Settings, label: 'Conta' }
]

interface GestorShellProps {
  tenantId: string
  companyName: string
  children: React.ReactNode
}

export function GestorShell({ tenantId, companyName, children }: GestorShellProps): JSX.Element {
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white flex">
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-[#111111] border-r border-white/8 z-30
          flex flex-col transition-transform duration-200
          lg:translate-x-0 lg:static lg:flex
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo / empresa */}
        <div className="px-5 py-5 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
              <Bot size={16} className="text-white/70" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-medium text-sm truncate">{companyName}</p>
              <p className="text-white/30 text-xs truncate">{tenantId}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const isActive = item.href === '/gestor'
              ? pathname === '/gestor'
              : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors
                  ${isActive
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white hover:bg-white/5'}
                `}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-white/8">
          <form action={gestorLogoutAction}>
            <button
              type="submit"
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors w-full"
            >
              <LogOut size={16} />
              Sair
            </button>
          </form>
        </div>
      </aside>

      {/* Conteúdo principal */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header mobile */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-[#111111]">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Menu size={18} />
          </button>
          <span className="text-white font-medium text-sm">{companyName}</span>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
