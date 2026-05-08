// layout.tsx — Layout autenticado do painel do gestor com sidebar clean
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../lib/gestor-session'
import { api } from '../../../lib/api'
import { GestorShell } from '../../../components/gestor/gestor-shell'

export default async function GestorAuthedLayout({
  children
}: {
  children: React.ReactNode
}): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  // Busca nome da empresa do tenant para exibir no header
  let companyName = session.tenant_id
  try {
    const settings = await api.settings(session.tenant_id)
    const nameSetting = settings.find((s) => s.key === 'business_company_name')
    if (nameSetting?.value) companyName = nameSetting.value
  } catch {
    // usa tenant_id como fallback
  }

  return (
    <GestorShell tenantId={session.tenant_id} companyName={companyName}>
      {children}
    </GestorShell>
  )
}
