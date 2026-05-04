// schema.ts — Define o schema SQLite completo do AttendentAI com Drizzle ORM
import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export type LeadStatus = 'novo' | 'ativo' | 'lead_quente' | 'convertido' | 'inativo'
export type MessageRole = 'user' | 'assistant'
export type MessageType = 'text' | 'audio' | 'image'
export type AgentType =
  | 'orchestrator'
  | 'classifier'
  | 'responder'
  | 'memory'
  | 'identifier'
  | 'internal'
  | 'custom'
export type SkillPriority = 'high' | 'medium' | 'low'

export const leads = sqliteTable('leads', {
  phone: text('phone').primaryKey(),
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
})

export const conversations = sqliteTable('conversations', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  lead_phone: text('lead_phone').references(() => leads.phone),
  started_at: integer('started_at', { mode: 'timestamp_ms' }).defaultNow(),
  ended_at: integer('ended_at', { mode: 'timestamp_ms' }),
  summary: text('summary'),
  intent_main: text('intent_main'),
  total_messages: integer('total_messages').default(0),
  total_tokens: integer('total_tokens').default(0)
})

export const messages = sqliteTable('messages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  conversation_id: text('conversation_id').references(() => conversations.id),
  lead_phone: text('lead_phone').references(() => leads.phone),
  role: text('role').$type<MessageRole>(),
  content: text('content'),
  message_type: text('message_type').$type<MessageType>().default('text'),
  audio_requested: integer('audio_requested', { mode: 'boolean' }).default(false),
  intent: text('intent'),
  tokens_used: integer('tokens_used').default(0),
  agent_used: text('agent_used'),
  processing_ms: integer('processing_ms'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow()
})

export const agents = sqliteTable('agents', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
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
})

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
  order: integer('order').default(0)
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  description: text('description'),
  updated_at: integer('updated_at', { mode: 'timestamp_ms' }).defaultNow()
})

export const tokenUsage = sqliteTable('token_usage', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  date: text('date'),
  model: text('model'),
  agent_type: text('agent_type'),
  prompt_tokens: integer('prompt_tokens').default(0),
  completion_tokens: integer('completion_tokens').default(0),
  total_tokens: integer('total_tokens').default(0),
  estimated_cost_usd: real('estimated_cost_usd').default(0)
})

export const agentTraces = sqliteTable('agent_traces', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  phone: text('phone'),
  run_id: text('run_id'),
  agent: text('agent'),
  event_type: text('event_type'),
  title: text('title'),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().default(sql`'{}'`),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).defaultNow()
})
