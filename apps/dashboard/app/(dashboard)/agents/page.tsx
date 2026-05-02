// page.tsx — Lista de agentes com toggle ativo/inativo
import { api } from '../../../lib/api'
import { AgentsClient } from './agents-client'

/**
 * Página de agentes — RSC que busca lista e delega ao client.
 * Passa apiError=true quando a API estiver inacessível.
 * @returns Página de gerenciamento de agentes.
 */
export default async function AgentsPage(): Promise<JSX.Element> {
  let agents: Awaited<ReturnType<typeof api.agents>> = []
  let skills: Awaited<ReturnType<typeof api.skills>> = []
  let apiError = false

  try {
    ;[agents, skills] = await Promise.all([api.agents(), api.skills()])
  } catch {
    apiError = true
  }

  return <AgentsClient initialAgents={agents} allSkills={skills} apiError={apiError} />
}
