// page.tsx — Gestão de blacklist do painel do gestor
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../../lib/gestor-session'
import { api } from '../../../../lib/api'
import { GestorBlacklistClient } from '../../../../components/gestor/gestor-blacklist-client'

export default async function GestorBlacklistPage(): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  const blacklistResult = await api.blacklist(session.tenant_id).catch(() => ({ items: [] }))

  return (
    <GestorBlacklistClient
      tenantId={session.tenant_id}
      initialItems={blacklistResult.items}
    />
  )
}
