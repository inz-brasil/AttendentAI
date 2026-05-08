// layout.tsx — Layout raiz do painel do gestor (sem sidebar admin)
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AttendentAI — Gestor',
  description: 'Painel do gestor'
}

export default function GestorRootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>
}
