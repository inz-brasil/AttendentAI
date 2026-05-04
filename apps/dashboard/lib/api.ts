// api.ts — Cliente HTTP tipado para a API do AttendentAI
const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export interface ApiErrorBody {
  error: string
  code: string
}

export interface Lead {
  phone: string
  name: string | null
  email: string | null
  city: string | null
  status: string | null
  tags: string[] | null
  total_messages: number | null
}

export interface Agent {
  id: string
  name: string
  description: string | null
  type: string | null
  model: string | null
  temperature: number | null
  max_tokens: number | null
  system_prompt: string | null
  is_active: boolean | null
  total_calls: number | null
  total_tokens: number | null
  created_at: string | null
  updated_at: string | null
}

export interface Skill {
  id: string
  name: string
  slug: string | null
  description: string | null
  category: string | null
  content: string | null
  when_to_use: string | null
  priority: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
}

export interface AgentSkillRow {
  skill_id: string | null
  order: number | null
  name: string | null
  description: string | null
  category: string | null
}

export interface AgentMetrics {
  total_calls: number
  total_tokens: number
  estimated_cost_usd: number
}

export interface Setting {
  key: string
  value: string | null
  description: string | null
}

export interface AgentTrace {
  id: string
  phone: string | null
  agent: string | null
  event_type: string | null
  title: string | null
  data: Record<string, unknown> | null
  created_at: string | null
}

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.error)
    this.status = status
    this.code = body.code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers
    },
    cache: 'no-store'
  })

  const body = (await response.json()) as T | ApiErrorBody

  if (!response.ok) {
    const errorBody = body as ApiErrorBody
    throw new ApiClientError(response.status, {
      error: errorBody.error ?? 'Erro na API',
      code: errorBody.code ?? 'API_ERROR'
    })
  }

  return body as T
}

export const api = {
  health: () => request<{ status: string; timestamp: string; version: string }>('/health'),
  leads: () => request<Lead[]>('/api/leads'),
  lead: (phone: string) => request<Lead>(`/api/leads/${encodeURIComponent(phone)}`),
  agents: () => request<Agent[]>('/api/agents'),
  agent: (id: string) => request<Agent>(`/api/agents/${encodeURIComponent(id)}`),
  agentSkills: (id: string) => request<AgentSkillRow[]>(`/api/agents/${encodeURIComponent(id)}/skills`),
  agentMetrics: (id: string) => request<AgentMetrics>(`/api/agents/${encodeURIComponent(id)}/metrics`),
  skills: () => request<Skill[]>('/api/skills'),
  skill: (id: string) => request<Skill>(`/api/skills/${encodeURIComponent(id)}`),
  settings: () => request<Setting[]>('/api/settings'),
  traces: () => request<{ traces: AgentTrace[] }>('/api/traces'),
  tracesByPhone: (phone: string) => request<{ traces: AgentTrace[] }>(`/api/traces/${encodeURIComponent(phone)}`),
  vault: () => request<{ leads: Array<{ phone: string; folder: string; path: string; name: string }> }>('/api/vault'),
  vaultFiles: (phone: string) => request<{ files: string[] }>(`/api/vault/${encodeURIComponent(phone)}/files`),
  vaultFile: (phone: string, filename: string) =>
    request<{ filename: string; content: string }>(
      `/api/vault/${encodeURIComponent(phone)}/files/${encodeURIComponent(filename)}`
    )
}
