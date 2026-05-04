// page.tsx — Timeline de rastreio do pipeline de mensagens e agentes
import { api } from '../../../lib/api'
import { TracesClient } from './traces-client'

/**
 * Página de logs operacionais do pipeline.
 * @returns Timeline com eventos recentes de agentes e tools.
 */
export default async function TracesPage(): Promise<JSX.Element> {
  let contacts: Awaited<ReturnType<typeof api.traceContacts>>['contacts'] = []

  try {
    const response = await api.traceContacts()
    contacts = response.contacts ?? []
  } catch {
    contacts = []
  }

  return <TracesClient initialContacts={contacts} />
}
