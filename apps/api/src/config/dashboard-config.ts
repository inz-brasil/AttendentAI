// dashboard-config.ts — Lê e grava configurações editáveis do dashboard na tabela settings
import { and, eq } from 'drizzle-orm'
import { env } from './env'
import { db } from '../db/client'
import { settings } from '../db/schema'

export type ConfigValue = string | number | boolean | string[] | Record<string, unknown> | null

export interface ConfigFieldDefinition {
  key: string
  type: 'string' | 'number' | 'boolean' | 'string_array'
  fallback: ConfigValue
  secret?: boolean
}

export type ConfigSection = Record<string, ConfigValue>

export const configDefinitions = {
  evolution: [
    { key: 'evolution_instance', type: 'string', fallback: env.EVOLUTION_INSTANCE ?? '' },
    { key: 'evolution_api_url', type: 'string', fallback: env.EVOLUTION_API_URL ?? '' },
    { key: 'evolution_local_url', type: 'string', fallback: env.EVOLUTION_LOCAL_URL ?? '' },
    { key: 'evolution_api_key', type: 'string', fallback: env.EVOLUTION_API_KEY ?? '', secret: true }
  ],
  business: [
    { key: 'business_tenant_id', type: 'string', fallback: 'default' },
    { key: 'business_company_name', type: 'string', fallback: '' },
    { key: 'business_summary', type: 'string', fallback: '' },
    { key: 'business_products_services', type: 'string', fallback: '' },
    { key: 'business_target_audience', type: 'string', fallback: '' },
    { key: 'business_tone', type: 'string', fallback: 'natural, profissional e direto' },
    { key: 'business_policies', type: 'string', fallback: '' },
    { key: 'business_website', type: 'string', fallback: '' }
  ],
  tenants: [
    { key: 'tenants_items', type: 'string', fallback: '[]' }
  ],
  evolution_instances: [
    { key: 'evolution_instances_items', type: 'string', fallback: '[]' }
  ],
  wacli: [
    { key: 'wacli_enabled', type: 'boolean', fallback: false },
    { key: 'wacli_active_phone', type: 'string', fallback: '' },
    { key: 'wacli_store', type: 'string', fallback: '' },
    { key: 'wacli_command', type: 'string', fallback: 'wacli' }
  ],
  automation: [
    { key: 'automation_enabled', type: 'boolean', fallback: true },
    { key: 'schedule_enabled', type: 'boolean', fallback: false },
    { key: 'schedule_timezone', type: 'string', fallback: 'America/Sao_Paulo' },
    { key: 'schedule_open_time', type: 'string', fallback: '18:00' },
    { key: 'schedule_close_time', type: 'string', fallback: '09:00' },
    { key: 'schedule_days', type: 'string_array', fallback: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    { key: 'reply_outside_schedule', type: 'boolean', fallback: false },
    { key: 'human_takeover_pause_minutes', type: 'number', fallback: 120 }
  ],
  queue: [
    { key: 'batch_window_ms', type: 'number', fallback: env.BATCH_WINDOW_MS },
    { key: 'batch_max_messages', type: 'number', fallback: env.BATCH_MAX_MESSAGES },
    { key: 'queue_concurrency', type: 'number', fallback: env.QUEUE_CONCURRENCY }
  ],
  audio: [
    { key: 'audio_enabled', type: 'boolean', fallback: env.AUDIO_ENABLED ?? env.AUDIO_AUTO_ENABLED },
    { key: 'audio_random_chance', type: 'number', fallback: env.AUDIO_RANDOM_CHANCE },
    { key: 'audio_max_chars', type: 'number', fallback: env.AUDIO_MAX_CHARS },
    { key: 'elevenlabs_api_key', type: 'string', fallback: env.ELEVENLABS_API_KEY ?? '', secret: true },
    { key: 'elevenlabs_voice_id', type: 'string', fallback: env.ELEVENLABS_VOICE_ID ?? '' }
  ],
  reactions: [
    { key: 'reactions_enabled', type: 'boolean', fallback: env.REACTIONS_ENABLED },
    { key: 'reactions_allowed_emojis', type: 'string', fallback: env.REACTIONS_ALLOWED_EMOJIS },
    { key: 'reactions_min_interval_minutes', type: 'number', fallback: env.REACTIONS_MIN_INTERVAL_MINUTES }
  ],
  presence: [
    { key: 'presence_enabled', type: 'boolean', fallback: true }
  ]
} satisfies Record<string, ConfigFieldDefinition[]>

/**
 * Carrega uma seção de configuração editável de um tenant.
 * @param section Nome da seção.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Configuração tipada com valores atuais.
 */
export async function getConfigSection(section: keyof typeof configDefinitions, tenantId = 'default'): Promise<ConfigSection> {
  const output: ConfigSection = {}
  for (const definition of configDefinitions[section]) {
    const raw = await getSettingValue(definition.key, tenantId)
    output[toPublicKey(definition.key, section)] = parseConfigValue(raw, definition)
  }

  return output
}

/**
 * Atualiza uma seção de configuração editável de um tenant sem reiniciar servidor.
 * @param section Nome da seção.
 * @param input Campos recebidos da API.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Configuração atualizada.
 */
export async function updateConfigSection(
  section: keyof typeof configDefinitions,
  input: Record<string, unknown>,
  tenantId = 'default'
): Promise<ConfigSection> {
  const definitions = configDefinitions[section]
  for (const definition of definitions) {
    const publicKey = toPublicKey(definition.key, section)
    const inputKey = publicKey in input ? publicKey : definition.key
    if (!(inputKey in input)) {
      continue
    }

    const value = serializeConfigValue(input[inputKey], definition)
    await upsertSetting(definition.key, value, tenantId)
    await writeLegacyAliases(definition.key, value, tenantId)
  }

  return getConfigSection(section, tenantId)
}

/**
 * Lê setting bruto de um tenant, retornando null quando ausente.
 * @param key Chave de setting.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Valor salvo ou null.
 */
export async function getSettingValue(key: string, tenantId = 'default'): Promise<string | null> {
  const [setting] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
    .limit(1)
  return setting?.value ?? null
}

/**
 * Faz upsert em uma setting de um tenant específico.
 * @param key Chave.
 * @param value Valor serializado.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Nada.
 */
export async function upsertSetting(key: string, value: string, tenantId = 'default'): Promise<void> {
  const [existing] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
    .limit(1)
  const now = new Date()
  if (existing) {
    await db
      .update(settings)
      .set({ value, updated_at: now })
      .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
    return
  }

  await db.insert(settings).values({ key, tenant_id: tenantId, value, updated_at: now })
}

function toPublicKey(key: string, section: keyof typeof configDefinitions): string {
  if (section === 'evolution') return removePrefix(key, 'evolution_')
  if (section === 'business') return removePrefix(key, 'business_')
  if (section === 'tenants') return removePrefix(key, 'tenants_')
  if (section === 'evolution_instances') return removePrefix(key, 'evolution_instances_')
  if (section === 'wacli') return removePrefix(key, 'wacli_')
  if (section === 'automation') {
    if (key === 'automation_enabled') return 'enabled'
    return removePrefix(key, 'schedule_')
  }
  if (section === 'audio') return removePrefix(removePrefix(key, 'audio_'), 'elevenlabs_')
  if (section === 'reactions') return removePrefix(key, 'reactions_')
  if (section === 'presence') return removePrefix(key, 'presence_')
  return key
}

function removePrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function parseConfigValue(raw: string | null, definition: ConfigFieldDefinition): ConfigValue {
  if (raw === null || raw === undefined) {
    return definition.secret ? redactSecret(definition.fallback) : definition.fallback
  }

  if (definition.type === 'boolean') return raw.trim().toLowerCase() === 'true'
  if (definition.type === 'number') return Number(raw)
  if (definition.type === 'string_array') return parseStringArray(raw)
  return definition.secret ? redactSecret(raw) : raw
}

function serializeConfigValue(value: unknown, definition: ConfigFieldDefinition): string {
  if (definition.type === 'boolean') return String(value === true)
  if (definition.type === 'number') return String(Number(value))
  if (definition.type === 'string_array') {
    return JSON.stringify(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  }
  return typeof value === 'string' ? value : String(value ?? '')
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // Aceita lista simples para facilitar edição manual no dashboard.
  }

  return raw.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean)
}

function redactSecret(value: ConfigValue): string {
  const raw = String(value ?? '')
  if (!raw) return ''
  return raw.length <= 8 ? '********' : `${raw.slice(0, 4)}...${raw.slice(-4)}`
}

async function writeLegacyAliases(key: string, value: string, tenantId = 'default'): Promise<void> {
  const aliases: Record<string, string[]> = {
    schedule_enabled: ['automation_schedule_enabled'],
    schedule_open_time: ['automation_schedule_start'],
    schedule_close_time: ['automation_schedule_end'],
    schedule_timezone: ['automation_schedule_timezone'],
    human_takeover_pause_minutes: ['automation_blacklist_default_minutes']
  }

  for (const alias of aliases[key] ?? []) {
    await upsertSetting(alias, value, tenantId)
  }
}
