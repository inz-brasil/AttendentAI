// page.tsx — Editor de agente: busca dados em paralelo e delega ao client
import { api } from '../../../../lib/api'
import { AgentEditorClient } from './agent-editor-client'
import { notFound } from 'next/navigation'

interface Props {
  params: { id: string }
}

/**
 * Página de edição de agente com 4 abas.
 * @param props id do agente via params.
 * @returns Editor completo do agente.
 */
export default async function AgentEditorPage({ params }: Props): Promise<JSX.Element> {
  const [agentResult, skillsResult, agentSkillsResult, metricsResult] = await Promise.allSettled([
    api.agent(params.id),
    api.skills(),
    api.agentSkills(params.id),
    api.agentMetrics(params.id)
  ])

  if (agentResult.status === 'rejected') notFound()

  return (
    <AgentEditorClient
      initialAgent={agentResult.value}
      allSkills={skillsResult.status === 'fulfilled' ? skillsResult.value : []}
      initialAgentSkills={agentSkillsResult.status === 'fulfilled' ? agentSkillsResult.value : []}
      initialMetrics={metricsResult.status === 'fulfilled' ? metricsResult.value : { total_calls: 0, total_tokens: 0, estimated_cost_usd: 0 }}
    />
  )
}
