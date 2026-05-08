// schema.ts — Define o schema SQLite completo do AttendentAI com Drizzle ORM
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export type LeadStatus = 'novo' | 'ativo' | 'lead_quente' | 'convertido' | 'inativo'
export type MessageRole = 'user' | 'assistant' | 'human_agent' | 'system'
export type MessageType = 'text' | 'audio' | 'image'
export type MessageEventSource = 'evolution' | 'wacli' | 'dashboard' | 'internal' | 'n8n_legacy'
export type MessageEventDirection = 'inbound' | 'outbound'
export type MessageEventSenderType =
  | 'customer'
  | 'bot'
  | 'human_agent'
  | 'internal_assistant'
  | 'system'
  | 'unknown'
export type MessageEventProcessedType = 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'unknown'
export type MessageEventDeliveryStatus = 'received' | 'intended' | 'sent' | 'failed' | 'ignored' | 'unknown'
export type TraceEventStatus = 'ok' | 'error' | 'ignored'
export type AgentType =
  | 'orchestrator'
  | 'classifier'
  | 'responder'
  | 'memory'
  | 'identifier'
  | 'internal'
  | 'custom'
export type SkillPriority = 'high' | 'medium' | 'low'
export type MCPTransport = 'http' | 'stdio'
export type MCPAuthType = 'none' | 'oauth2' | 'api_key'

export interface MCPTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

const crockfordBase32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function createUlid(): string {
  const now = Date.now()
  let timestamp = ''
  let value = now
  for (let index = 0; index < 10; index += 1) {
    timestamp = crockfordBase32[value % 32] + timestamp
    value = Math.floor(value / 32)
  }

  let randomness = ''
  for (let index = 0; index < 16; index += 1) {
    randomness += crockfordBase32[Math.floor(Math.random() * 32)]
  }

  return timestamp + randomness
}

// PK composta (tenant_id, phone) — o mesmo número pode existir em tenants distintos
export const leads = sqliteTable('leads', {
  phone: text('phone').notNull(),
  tenant_id: text('tenant_id').notNull().default('default'),
  name: text('name'),
  email: text('email'),
  city: text('city'),
  status: text('status').$type<LeadStatus>().default('novo'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default(sql`'[]'`),
  custom_data: text('custom_data', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .default(sql`'{}'`),
  vault_path: text('vault_path'),
  total_messages: integer('total_messages').default(0),
  last_message_at: integer('last_message_at', { mode: 'timestamp_ms' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow()
}, (table) => [
  primaryKey({ columns: [table.tenant_id, table.phone] }),
  index('idx_leads_tenant_phone').on(table.tenant_id, table.phone),
  index('idx_leads_last_message').on(table.tenant_id, table.last_message_at)
])

// FK a leads.phone removida — integridade garantida pela camada de aplicação com tenant_id
export const conversations = sqliteTable('conversations', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenant_id: text('tenant_id').notNull().default('default'),
  lead_phone: text('lead_phone'),
  started_at: integer('started_at', { mode: 'timestamp_ms' }).defaultNow(),
  ended_at: integer('ended_at', { mode: 'timestamp_ms' }),
  summary: text('summary'),
  intent_main: text('intent_main'),
  total_messages: integer('total_messages').default(0),
  total_tokens: integer('total_tokens').default(0)
}, (table) => [
  index('idx_conversations_tenant').on(table.tenant_id, table.lead_phone)
])

// FK a leads.phone removida — integridade garantida pela camada de aplicação com tenant_id
export const messages = sqliteTable('messages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenant_id: text('tenant_id').notNull().default('default'),
  conversation_id: text('conversation_id').references(() => conversations.id),
  lead_phone: text('lead_phone'),
  role: text('role').$type<MessageRole>(),
  content: text('content'),
  message_type: text('message_type').$type<MessageType>().default('text'),
  audio_requested: integer('audio_requested', { mode: 'boolean' }).default(false),
  intent: text('intent'),
  tokens_used: integer('tokens_used').default(0),
  agent_used: text('agent_used'),
  processing_ms: integer('processing_ms'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow()
}, (table) => [
  index('idx_messages_tenant').on(table.tenant_id, table.lead_phone)
])

export const messageEvents = sqliteTable('message_events', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createUlid()),
  tenant_id: text('tenant_id').notNull(),
  conversation_id: text('conversation_id').references(() => conversations.id),
  lead_phone: text('lead_phone').notNull(),
  external_message_id: text('external_message_id'),
  source: text('source').$type<MessageEventSource>().notNull(),
  source_event: text('source_event'),
  direction: text('direction').$type<MessageEventDirection>().notNull(),
  from_me: integer('from_me', { mode: 'boolean' }).notNull(),
  sender_type: text('sender_type').$type<MessageEventSenderType>().notNull(),
  role: text('role').$type<MessageRole>().notNull(),
  content: text('content').notNull(),
  content_hash: text('content_hash').notNull(),
  message_type: text('message_type').notNull(),
  processed_type: text('processed_type').$type<MessageEventProcessedType>().notNull(),
  media_url: text('media_url'),
  quoted_external_message_id: text('quoted_external_message_id'),
  quoted_content: text('quoted_content'),
  remote_jid: text('remote_jid'),
  instance: text('instance'),
  instance_id: text('instance_id'),
  chatwoot_conversation_id: integer('chatwoot_conversation_id'),
  chatwoot_inbox_id: integer('chatwoot_inbox_id'),
  chatwoot_message_id: integer('chatwoot_message_id'),
  delivery_status: text('delivery_status').$type<MessageEventDeliveryStatus>().notNull(),
  batch_id: text('batch_id'),
  error_message: text('error_message'),
  raw_payload: text('raw_payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  whatsapp_timestamp: integer('whatsapp_timestamp').notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow().notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow().notNull()
}, (table) => [
  index('idx_me_tenant_phone_ts').on(table.tenant_id, table.lead_phone, table.whatsapp_timestamp),
  index('idx_me_tenant_phone_cr').on(table.tenant_id, table.lead_phone, table.created_at),
  index('idx_me_tenant_ext_id').on(table.tenant_id, table.source, table.external_message_id),
  index('idx_me_tenant_dedupe').on(table.tenant_id, table.content_hash, table.lead_phone, table.direction),
  index('idx_me_delivery_status').on(table.tenant_id, table.delivery_status),
  index('idx_me_instance').on(table.tenant_id, table.instance),
  index('idx_me_remote_jid').on(table.tenant_id, table.remote_jid),
  index('idx_me_batch_id').on(table.batch_id)
])

export const traceEvents = sqliteTable('trace_events', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createUlid()),
  tenant_id: text('tenant_id').notNull(),
  batch_id: text('batch_id'),
  phone: text('phone'),
  event: text('event').notNull(),
  status: text('status').$type<TraceEventStatus>().notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  duration_ms: integer('duration_ms'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow().notNull()
}, (table) => [
  index('idx_te_tenant_event_created').on(table.tenant_id, table.event, table.created_at),
  index('idx_te_batch_id').on(table.batch_id),
  index('idx_te_tenant_phone_created').on(table.tenant_id, table.phone, table.created_at)
])

// tenant_id permite agentes customizados por tenant; fallback para 'default' no orchestrator
export const agents = sqliteTable('agents', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenant_id: text('tenant_id').notNull().default('default'),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').$type<AgentType>(),
  model: text('model').default('gpt-4o-mini'),
  temperature: real('temperature').default(0.3),
  max_tokens: integer('max_tokens').default(1000),
  system_prompt: text('system_prompt'),
  is_active: integer('is_active', { mode: 'boolean' }).default(true),
  total_calls: integer('total_calls').default(0),
  total_tokens: integer('total_tokens').default(0),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow()
}, (table) => [
  index('idx_agents_tenant').on(table.tenant_id)
])

export const skills = sqliteTable('skills', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  description: text('description'),
  category: text('category'),
  content: text('content'),
  when_to_use: text('when_to_use'),
  priority: text('priority').$type<SkillPriority>().default('medium'),
  is_active: integer('is_active', { mode: 'boolean' }).default(true),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow()
})

export const agentSkills = sqliteTable('agent_skills', {
  agent_id: text('agent_id').references(() => agents.id),
  skill_id: text('skill_id').references(() => skills.id),
  tenant_id: text('tenant_id').notNull().default('default'),
  order: integer('order').default(0)
})

// PK composta (tenant_id, phone) — metadados de compactação de memória por tenant
export const leadMemoryMeta = sqliteTable('lead_memory_meta', {
  phone: text('phone').notNull(),
  tenant_id: text('tenant_id').notNull().default('default'),
  last_compaction_at: integer('last_compaction_at', { mode: 'timestamp_ms' }),
  total_compactions: integer('total_compactions').default(0),
  total_messages_summarized: integer('total_messages_summarized').default(0)
}, (table) => [
  primaryKey({ columns: [table.tenant_id, table.phone] }),
  index('idx_lead_memory_meta_tenant').on(table.tenant_id, table.phone)
])

export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  transport: text('transport').$type<MCPTransport>().notNull(),
  url: text('url'),
  command: text('command'),
  auth_type: text('auth_type').$type<MCPAuthType>().default('none'),
  is_active: integer('is_active', { mode: 'boolean' }).default(true),
  tools_cache: text('tools_cache', { mode: 'json' }).$type<MCPTool[]>(),
  tools_cached_at: integer('tools_cached_at', { mode: 'timestamp_ms' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow()
})

export const agentMcpServers = sqliteTable('agent_mcp_servers', {
  agent_id: text('agent_id').references(() => agents.id),
  mcp_server_id: text('mcp_server_id').references(() => mcpServers.id),
  enabled: integer('enabled', { mode: 'boolean' }).default(true)
})

export const mcpCredentials = sqliteTable('mcp_credentials', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  mcp_server_id: text('mcp_server_id').references(() => mcpServers.id),
  scope: text('scope').default('system'),
  access_token_encrypted: text('access_token_encrypted'),
  refresh_token_encrypted: text('refresh_token_encrypted'),
  token_expiry: integer('token_expiry', { mode: 'timestamp_ms' }),
  granted_at: integer('granted_at', { mode: 'timestamp_ms' }),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow()
})

// PK composta (tenant_id, phone) — blacklist isolada por tenant
export const automationBlacklist = sqliteTable('automation_blacklist', {
  phone: text('phone').notNull(),
  tenant_id: text('tenant_id').notNull().default('default'),
  reason: text('reason').default('human_takeover'),
  source: text('source').default('system'),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow(),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow()
}, (table) => [
  primaryKey({ columns: [table.tenant_id, table.phone] }),
  index('idx_blacklist_tenant_phone').on(table.tenant_id, table.phone)
])

// PK composta (tenant_id, key) — settings isoladas por tenant
export const settings = sqliteTable('settings', {
  key: text('key').notNull(),
  tenant_id: text('tenant_id').notNull().default('default'),
  value: text('value'),
  description: text('description'),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow()
}, (table) => [
  primaryKey({ columns: [table.tenant_id, table.key] }),
  index('idx_settings_tenant_key').on(table.tenant_id, table.key)
])

export const tokenUsage = sqliteTable('token_usage', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenant_id: text('tenant_id').notNull().default('default'),
  date: text('date'),
  model: text('model'),
  agent_type: text('agent_type'),
  prompt_tokens: integer('prompt_tokens').default(0),
  completion_tokens: integer('completion_tokens').default(0),
  total_tokens: integer('total_tokens').default(0),
  estimated_cost_usd: real('estimated_cost_usd').default(0)
}, (table) => [
  index('idx_token_usage_tenant').on(table.tenant_id)
])

export const agentTraces = sqliteTable('agent_traces', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenant_id: text('tenant_id').notNull().default('default'),
  phone: text('phone'),
  run_id: text('run_id'),
  agent: text('agent'),
  event_type: text('event_type'),
  title: text('title'),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().default(sql`'{}'`),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow()
}, (table) => [
  index('idx_agent_traces_tenant').on(table.tenant_id, table.phone)
])
