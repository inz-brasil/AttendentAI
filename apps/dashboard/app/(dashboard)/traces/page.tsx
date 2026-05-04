// page.tsx — Timeline de rastreio do pipeline de mensagens e agentes
import { api } from '../../../lib/api'
import { TracesClient } from './traces-client'

/**
 * Página de logs operacionais do pipeline.
 * @returns Timeline com eventos recentes de agentes e tools.
 */
export default async function TracesPage(): Promise<JSX.Element> {
  let traces: Awaited<ReturnType<typeof api.traces>>['traces'] = []

  try {
    const response = await api.traces()
    traces = response.traces ?? []
  } catch {
    traces = []
  }

  return <TracesClient initialTraces={traces} />
}
