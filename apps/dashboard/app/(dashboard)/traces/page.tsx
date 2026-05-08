// page.tsx — Timeline de rastreio do pipeline de mensagens e agentes
import { api } from '../../../lib/api'
import { TracesClient } from './traces-client'

/**
 * Página de logs operacionais do pipeline.
 * @param props Parâmetros de URL incluindo tenant_id.
 * @returns Timeline com eventos recentes de agentes e tools.
 */
export default async function TracesPage({
  searchParams
}: {
  searchParams: { tenant_id?: string }
}): Promise<JSX.Element> {
  const tenantId = searchParams.tenant_id ?? 'default'
  let contacts: Awaited<ReturnType<typeof api.traceContacts>>['contacts'] = []

  try {
    const response = await api.traceContacts(tenantId)
    contacts = response.contacts ?? []
  } catch {
    contacts = []
  }

  return <TracesClient initialContacts={contacts} tenantId={tenantId} />
}
