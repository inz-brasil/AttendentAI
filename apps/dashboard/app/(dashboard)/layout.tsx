// layout.tsx — Layout protegido com navegação principal
import { AppShell } from '../../components/app-shell'

/**
 * Layout das rotas autenticadas.
 * @param props Conteúdo protegido.
 * @returns Shell do dashboard.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <AppShell>{children}</AppShell>
}
