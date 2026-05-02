// page.tsx — Lista de leads: tabela com busca, filtro, paginação e ações
import { api } from '../../../lib/api'
import { LeadsClient } from './leads-client'

/**
 * Página de leads — RSC que busca dados e delega ao client.
 * @returns Página de gerenciamento de leads.
 */
export default async function LeadsPage(): Promise<JSX.Element> {
  let leads: Awaited<ReturnType<typeof api.leads>> = []
  try {
    leads = await api.leads()
  } catch {
    // Renderiza lista vazia se API estiver offline
  }

  return <LeadsClient initialLeads={leads} />
}
