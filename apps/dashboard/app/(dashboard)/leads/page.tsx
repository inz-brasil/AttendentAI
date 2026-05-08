// page.tsx — Lista de leads: tabela com busca, filtro, paginação e ações
import { api } from '../../../lib/api'
import { LeadsClient } from './leads-client'

/**
 * Página de leads — RSC que busca dados e delega ao client.
 * @param props Parâmetros de URL incluindo tenant_id.
 * @returns Página de gerenciamento de leads.
 */
export default async function LeadsPage({
  searchParams
}: {
  searchParams: { tenant_id?: string }
}): Promise<JSX.Element> {
  const tenantId = searchParams.tenant_id ?? 'default'
  let leads: Awaited<ReturnType<typeof api.leads>> = []
  try {
    leads = await api.leads(tenantId)
  } catch {
    // Renderiza lista vazia se API estiver offline
  }

  return <LeadsClient initialLeads={leads} tenantId={tenantId} />
}
