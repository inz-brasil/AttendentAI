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
  last_message_at?: string | null
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
  lead_name?: string | null
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

export interface WacliDoctorBody {
  success?: boolean
  data?: {
    store_dir?: string
    lock_held?: boolean
    authenticated?: boolean
    connected?: boolean
    fts_enabled?: boolean
  }
  error?: string | null
}

export interface WacliStatus {
  installed: boolean
  enabled: boolean
  command: string
  store: string
  auth_running: boolean
  sync_running: boolean
  doctor: WacliDoctorBody | null
  error: string | null
}

export interface ConfigResponse {
  section: string
  config: Record<string, unknown>
}

export interface BlacklistEntry {
  phone: string
  reason: string | null
  expires_at: string | null
  created_at: string | null
}

export interface Tenant {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

export interface QueueStatus {
  counts: Record<string, number>
  jobs: Record<string, Array<Record<string, unknown>>>
}

export interface MessageEventRow {
  id: string
  tenant_id: string
  lead_phone: string
  direction: 'inbound' | 'outbound'
  sender_type: string
  role: 'user' | 'assistant' | 'human_agent' | 'system'
  content: string
  delivery_status: string
  whatsapp_timestamp: number
  created_at: string
}

export interface TraceEventRow {
  id: string
  tenant_id: string
  batch_id: string | null
  phone: string | null
  event: string
  status: 'ok' | 'error' | 'ignored'
  data: Record<string, unknown>
  duration_ms: number | null
  created_at: string
}

export interface WacliProcessStatus {
  running: boolean
  output: string
  started_at: string | null
  exited_at: string | null
  exit_code: number | null
  error: string | null
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
  const headers: Record<string, string> = init.body ? { 'Content-Type': 'application/json' } : {}
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
  leads: (tenantId = 'default') => request<Lead[]>(`/api/leads?tenant_id=${encodeURIComponent(tenantId)}`),
  lead: (phone: string, tenantId = 'default') =>
    request<Lead>(`/api/leads/${encodeURIComponent(phone)}?tenant_id=${encodeURIComponent(tenantId)}`),
  conversations: (tenantId = 'default') =>
    request<{ messages: ConversationMessage[] }>(`/api/conversations?tenant_id=${encodeURIComponent(tenantId)}`),
  agents: () => request<Agent[]>('/api/agents'),
  agent: (id: string) => request<Agent>(`/api/agents/${encodeURIComponent(id)}`),
  agentSkills: (id: string) => request<AgentSkillRow[]>(`/api/agents/${encodeURIComponent(id)}/skills`),
  agentMetrics: (id: string) => request<AgentMetrics>(`/api/agents/${encodeURIComponent(id)}/metrics`),
  skills: () => request<Skill[]>('/api/skills'),
  skill: (id: string) => request<Skill>(`/api/skills/${encodeURIComponent(id)}`),
  settings: (tenantId = 'default') => request<Setting[]>(`/api/settings?tenant_id=${encodeURIComponent(tenantId)}`),
  traces: (tenantId = 'default') =>
    request<{ traces: AgentTrace[] }>(`/api/traces?tenant_id=${encodeURIComponent(tenantId)}`),
  traceContacts: (tenantId = 'default') =>
    request<{ contacts: TraceContact[] }>(`/api/traces/contacts?tenant_id=${encodeURIComponent(tenantId)}`),
  traceRuns: (phone: string, tenantId = 'default') =>
    request<{ runs: TraceRun[] }>(`/api/traces/${encodeURIComponent(phone)}/runs?tenant_id=${encodeURIComponent(tenantId)}`),
  tracesByPhone: (phone: string, tenantId = 'default') =>
    request<{ traces: AgentTrace[] }>(`/api/traces/${encodeURIComponent(phone)}?tenant_id=${encodeURIComponent(tenantId)}`),
  vault: (tenantId = 'default') =>
    request<{ leads: Array<{ phone: string; folder: string; path: string; name: string }> }>(
      `/api/vault?tenant_id=${encodeURIComponent(tenantId)}`
    ),
  vaultFiles: (phone: string, tenantId = 'default') =>
    request<{ files: string[] }>(`/api/vault/${encodeURIComponent(phone)}/files?tenant_id=${encodeURIComponent(tenantId)}`),
  vaultFile: (phone: string, filename: string, tenantId = 'default') =>
    request<{ filename: string; content: string }>(
      `/api/vault/${encodeURIComponent(phone)}/files/${encodeURIComponent(filename)}?tenant_id=${encodeURIComponent(tenantId)}`
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
    request<{ success: boolean }>(`/api/mcp/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' }),
  getWacliStatus: () => request<WacliStatus>('/api/wacli/status'),
  startWacliAuth: () => request<{ success: boolean; status: WacliProcessStatus }>('/api/wacli/auth/start', { method: 'POST' }),
  getWacliAuthOutput: () => request<WacliProcessStatus>('/api/wacli/auth/output'),
  stopWacliAuth: () => request<{ success: boolean }>('/api/wacli/auth/stop', { method: 'POST' }),
  startWacliSync: () => request<{ success: boolean; status: WacliProcessStatus }>('/api/wacli/sync/start', { method: 'POST' }),
  getWacliSyncOutput: () => request<WacliProcessStatus>('/api/wacli/sync/output'),
  stopWacliSync: () => request<{ success: boolean }>('/api/wacli/sync/stop', { method: 'POST' }),
  enableWacli: () => request<{ success: boolean }>('/api/wacli/enable', { method: 'POST' }),
  disableWacli: () => request<{ success: boolean }>('/api/wacli/disable', { method: 'POST' }),
  configSection: (section: string, tenantId = 'default') =>
    request<ConfigResponse>(`/api/config/${encodeURIComponent(section)}?tenant_id=${encodeURIComponent(tenantId)}`),
  updateConfigSection: (section: string, data: Record<string, unknown>, tenantId = 'default') =>
    request<ConfigResponse>(`/api/config/${encodeURIComponent(section)}?tenant_id=${encodeURIComponent(tenantId)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  blacklist: (tenantId = 'default') => request<{ items: BlacklistEntry[] }>(`/api/blacklist?tenant_id=${encodeURIComponent(tenantId)}`),
  addBlacklist: (data: { tenant_id?: string; phone: string; reason?: string; duration_minutes?: number | null }) =>
    request<{ success: boolean; item: BlacklistEntry }>('/api/blacklist', { method: 'POST', body: JSON.stringify(data) }),
  removeBlacklist: (phone: string, tenantId = 'default') =>
    request<{ success: boolean }>(`/api/blacklist/${encodeURIComponent(phone)}?tenant_id=${encodeURIComponent(tenantId)}`, { method: 'DELETE' }),
  leadTranscript: (phone: string, tenantId = 'default', limit = 50) =>
    request<{ messages: MessageEventRow[] }>(
      `/api/leads/${encodeURIComponent(phone)}/transcript?tenant_id=${encodeURIComponent(tenantId)}&limit=${limit}`
    ),
  leadVault: (phone: string, tenantId = 'default') =>
    request<{ phone: string; files: Record<string, string | null> }>(
      `/api/leads/${encodeURIComponent(phone)}/vault?tenant_id=${encodeURIComponent(tenantId)}`
    ),
  leadMemoryStats: (phone: string, tenantId = 'default') =>
    request<{ total_messages: number; last_compaction_at: string | null; total_compactions: number; vault_files: string[] }>(
      `/api/leads/${encodeURIComponent(phone)}/memory-stats?tenant_id=${encodeURIComponent(tenantId)}`
    ),
  deleteLeadHistory: (phone: string, tenantId = 'default') =>
    request<{ success: boolean }>(
      `/api/leads/${encodeURIComponent(phone)}/history?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'DELETE' }
    ),
  deleteLead: (phone: string, tenantId = 'default') =>
    request<{ success: boolean }>(
      `/api/leads/${encodeURIComponent(phone)}?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'DELETE' }
    ),
  traceTimeline: (batchId: string, tenantId = 'default') =>
    request<{ traces: TraceEventRow[] }>(`/api/traces?batch_id=${encodeURIComponent(batchId)}&tenant_id=${encodeURIComponent(tenantId)}`),
  queueStatus: () => request<QueueStatus>('/api/queue/status'),
  testEvolutionSend: (data: { number: string; text: string; instance?: string }) =>
    request<Record<string, unknown>>('/api/test/evolution/send', { method: 'POST', body: JSON.stringify(data) }),
  testEvolutionMedia: (data: { message_id: string; instance?: string }) =>
    request<Record<string, unknown>>('/api/test/evolution/media', { method: 'POST', body: JSON.stringify(data) }),
  tenants: () => request<Tenant[]>('/api/tenants'),
  createTenant: (data: { name: string; id?: string; description?: string }) =>
    request<Tenant>('/api/tenants', { method: 'POST', body: JSON.stringify(data) }),
  updateTenant: (id: string, data: { name?: string; description?: string; is_active?: boolean }) =>
    request<Tenant>(`/api/tenants/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deactivateTenant: (id: string) =>
    request<{ success: boolean }>(`/api/tenants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  gestorAuth: (tenantId: string, password: string) =>
    request<{ valid: boolean; tenant_id: string }>('/api/gestor/auth', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: tenantId, password })
    }),
  sendMessage: (phone: string, text: string, tenantId = 'default') =>
    request<{ success: boolean; message_id: string | null }>(
      `/api/leads/${encodeURIComponent(phone)}/send-message?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'POST', body: JSON.stringify({ text }) }
    )
}
