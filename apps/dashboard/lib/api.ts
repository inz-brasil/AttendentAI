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

export interface ConversationMessage {
  id: string
  lead_phone: string | null
  role: 'user' | 'assistant' | null
  content: string | null
  intent: string | null
  agent_used: string | null
  created_at: string | null
}

export interface Setting {
  key: string
  value: string | null
  description: string | null
}

export interface AgentTrace {
  id: string
  phone: string | null
  run_id: string | null
  agent: string | null
  event_type: string | null
  title: string | null
  data: Record<string, unknown> | null
  created_at: string | null
}

export interface TraceContact {
  phone: string
  lead_name: string | null
  last_message: string | null
  last_response: string | null
  last_at: string | null
  run_count: number
  event_count: number
}

export interface TraceRun {
  run_id: string
  phone: string
  started_at: string | null
  ended_at: string | null
  message_preview: string | null
  response_preview: string | null
  status: 'success' | 'error'
  events: AgentTrace[]
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpServer {
  id: string
  name: string
  slug: string
  transport: 'http' | 'stdio'
  url: string | null
  command: string | null
  auth_type: 'none' | 'oauth2' | 'api_key' | null
  is_active: boolean | null
  tools_cache: McpTool[] | null
  tools_cached_at: string | null
  created_at: string | null
}

export interface AgentMcpServerRow {
  agent_id: string | null
  mcp_server_id: string | null
  enabled: boolean | null
}

export interface CalendarStatus {
  connected: boolean
  server: McpServer | null
  credential: {
    id: string
    scope: string | null
    granted_at: string | null
    updated_at: string | null
    token_expiry: string | null
  } | null
  account_email: string | null
  tools_count: number
  selected_calendar_id?: string
  event_description_template?: string
}

export interface GoogleCalendarOption {
  id: string
  summary: string
  primary: boolean
  access_role: string | null
  selected: boolean
}

export interface NewMcpServerInput {
  name: string
  slug: string
  transport: 'http' | 'stdio'
  url?: string | null
  command?: string | null
  auth_type: 'none' | 'oauth2' | 'api_key'
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (process.env.WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${process.env.WEBHOOK_SECRET}`
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...headers,
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
  conversations: () => request<{ messages: ConversationMessage[] }>('/api/conversations'),
  agents: () => request<Agent[]>('/api/agents'),
  agent: (id: string) => request<Agent>(`/api/agents/${encodeURIComponent(id)}`),
  agentSkills: (id: string) => request<AgentSkillRow[]>(`/api/agents/${encodeURIComponent(id)}/skills`),
  agentMetrics: (id: string) => request<AgentMetrics>(`/api/agents/${encodeURIComponent(id)}/metrics`),
  skills: () => request<Skill[]>('/api/skills'),
  skill: (id: string) => request<Skill>(`/api/skills/${encodeURIComponent(id)}`),
  settings: () => request<Setting[]>('/api/settings'),
  traces: () => request<{ traces: AgentTrace[] }>('/api/traces'),
  traceContacts: () => request<{ contacts: TraceContact[] }>('/api/traces/contacts'),
  traceRuns: (phone: string) => request<{ runs: TraceRun[] }>(`/api/traces/${encodeURIComponent(phone)}/runs`),
  tracesByPhone: (phone: string) => request<{ traces: AgentTrace[] }>(`/api/traces/${encodeURIComponent(phone)}`),
  vault: () => request<{ leads: Array<{ phone: string; folder: string; path: string; name: string }> }>('/api/vault'),
  vaultFiles: (phone: string) => request<{ files: string[] }>(`/api/vault/${encodeURIComponent(phone)}/files`),
  vaultFile: (phone: string, filename: string) =>
    request<{ filename: string; content: string }>(
      `/api/vault/${encodeURIComponent(phone)}/files/${encodeURIComponent(filename)}`
    ),
  getMcpServers: () => request<McpServer[]>('/api/mcp/servers'),
  getAgentMcpServers: (agentId: string) =>
    request<AgentMcpServerRow[]>(`/api/agents/${encodeURIComponent(agentId)}/mcp`),
  testMcpServer: (id: string) =>
    request<{ status: string; tools: string[] }>(`/api/mcp/servers/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  addMcpServer: (data: NewMcpServerInput) =>
    request<McpServer>('/api/mcp/servers', { method: 'POST', body: JSON.stringify(data) }),
  removeMcpServer: (id: string) =>
    request<{ success: boolean }>(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateAgentMcpServers: (agentId: string, serverIds: string[]) =>
    request<{ success: boolean; count: number }>(`/api/agents/${encodeURIComponent(agentId)}/mcp`, {
      method: 'PUT',
      body: JSON.stringify({ servers: serverIds.map((id) => ({ mcp_server_id: id, enabled: true })) })
    }),
  getCalendarStatus: () => request<CalendarStatus>('/api/mcp/google-calendar/status'),
  getGoogleCalendars: () =>
    request<{ selected_calendar_id: string; calendars: GoogleCalendarOption[] }>('/api/mcp/google-calendar/calendars'),
  disconnectCalendar: (credentialId: string) =>
    request<{ success: boolean }>(`/api/mcp/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' })
}
