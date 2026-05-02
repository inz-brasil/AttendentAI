// page.tsx — Playground de testes do pipeline multiagente
import { api } from '../../../lib/api'
import { PlaygroundClient } from './playground-client'

export default async function PlaygroundPage(): Promise<JSX.Element> {
  let agents: Awaited<ReturnType<typeof api.agents>> = []
  let leads: Awaited<ReturnType<typeof api.leads>> = []
  try {
    ;[agents, leads] = await Promise.all([api.agents(), api.leads()])
  } catch { /* API offline */ }

  return <PlaygroundClient agents={agents} leads={leads} />
}
