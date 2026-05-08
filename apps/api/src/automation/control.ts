// control.ts — Centraliza regras de automação, horário e blacklist de atendimento
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db/client'
import { automationBlacklist, settings } from '../db/schema'

export interface AutomationDecision {
  allowed: boolean
  reason: 'automation_disabled' | 'schedule_closed' | 'blacklist_active' | 'allowed'
  schedule: AutomationSchedule
  blacklist: {
    active: boolean
    reason: string | null
    expires_at: Date | null
  }
}

export interface AutomationSchedule {
  enabled: boolean
  start: string
  end: string
  timezone: string
  now_minutes: number
  inside_window: boolean
}

const DEFAULT_BLACKLIST_MINUTES = 120

/**
 * Decide se o bot pode responder automaticamente para um telefone agora.
 * @param phone Telefone do lead.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Decisão com motivo e dados de auditoria.
 */
export async function canReplyAutomatically(phone: string, tenantId = 'default'): Promise<AutomationDecision> {
  await cleanupExpiredBlacklist(phone, tenantId)
  const [enabledRaw, schedule, blacklist] = await Promise.all([
    getSettingValue('automation_enabled', 'true', tenantId),
    getAutomationSchedule(tenantId),
    getActiveBlacklist(phone, tenantId)
  ])

  if (enabledRaw.trim().toLowerCase() === 'false') {
    return { allowed: false, reason: 'automation_disabled', schedule, blacklist }
  }

  if (schedule.enabled && !schedule.inside_window) {
    return { allowed: false, reason: 'schedule_closed', schedule, blacklist }
  }

  if (blacklist.active) {
    return { allowed: false, reason: 'blacklist_active', schedule, blacklist }
  }

  return { allowed: true, reason: 'allowed', schedule, blacklist }
}

/**
 * Pausa respostas automáticas para um lead quando humano assume atendimento.
 * @param phone Telefone do lead.
 * @param reason Motivo auditável.
 * @param source Origem da pausa.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Registro atualizado.
 */
export async function activateAutomationBlacklist(
  phone: string,
  reason = 'human_takeover',
  source = 'evolution',
  tenantId = 'default'
): Promise<{ phone: string; expires_at: Date }> {
  const minutes = Number(await getSettingValue('automation_blacklist_default_minutes', String(DEFAULT_BLACKLIST_MINUTES), tenantId))
  const expiresAt = new Date(Date.now() + Math.max(1, minutes || DEFAULT_BLACKLIST_MINUTES) * 60_000)
  const [existing] = await db
    .select()
    .from(automationBlacklist)
    .where(and(eq(automationBlacklist.tenant_id, tenantId), eq(automationBlacklist.phone, phone)))
    .limit(1)

  if (existing) {
    await db
      .update(automationBlacklist)
      .set({ reason, source, expires_at: expiresAt, updated_at: new Date() })
      .where(and(eq(automationBlacklist.tenant_id, tenantId), eq(automationBlacklist.phone, phone)))
  } else {
    await db.insert(automationBlacklist).values({ phone, tenant_id: tenantId, reason, source, expires_at: expiresAt })
  }

  return { phone, expires_at: expiresAt }
}

/**
 * Remove pausa automática de um lead.
 * @param phone Telefone do lead.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Nada.
 */
export async function deactivateAutomationBlacklist(phone: string, tenantId = 'default'): Promise<void> {
  await db.delete(automationBlacklist).where(and(eq(automationBlacklist.tenant_id, tenantId), eq(automationBlacklist.phone, phone)))
}

/**
 * Lista configurações atuais de automação.
 * @returns Estado da automação.
 */
export async function getAutomationStatus(tenantId = 'default'): Promise<Record<string, unknown>> {
  const schedule = await getAutomationSchedule(tenantId)
  const enabled = (await getSettingValue('automation_enabled', 'true', tenantId)).trim().toLowerCase() !== 'false'
  const activeBlacklist = await db
    .select()
    .from(automationBlacklist)
    .where(and(eq(automationBlacklist.tenant_id, tenantId), gt(automationBlacklist.expires_at, new Date())))

  return {
    automation_enabled: enabled,
    schedule,
    active_blacklist_count: activeBlacklist.length,
    active_blacklist: activeBlacklist.map((item) => ({
      phone: item.phone,
      reason: item.reason,
      source: item.source,
      expires_at: item.expires_at
    }))
  }
}

/**
 * Atualiza configurações de automação de forma idempotente.
 * @param input Campos opcionais de configuração.
 * @returns Estado atualizado.
 */
export async function updateAutomationSettings(
  input: {
    enabled?: boolean | undefined
    schedule_enabled?: boolean | undefined
    schedule_start?: string | undefined
    schedule_end?: string | undefined
    timezone?: string | undefined
    blacklist_default_minutes?: number | undefined
  },
  tenantId = 'default'
): Promise<Record<string, unknown>> {
  const updates: Array<{ key: string; value: string }> = []
  if (input.enabled !== undefined) updates.push({ key: 'automation_enabled', value: String(input.enabled) })
  if (input.schedule_enabled !== undefined) updates.push({ key: 'automation_schedule_enabled', value: String(input.schedule_enabled) })
  if (input.schedule_start) updates.push({ key: 'automation_schedule_start', value: input.schedule_start })
  if (input.schedule_end) updates.push({ key: 'automation_schedule_end', value: input.schedule_end })
  if (input.timezone) updates.push({ key: 'automation_schedule_timezone', value: input.timezone })
  if (input.blacklist_default_minutes !== undefined) {
    updates.push({ key: 'automation_blacklist_default_minutes', value: String(input.blacklist_default_minutes) })
  }

  for (const update of updates) {
    await upsertSetting(update.key, update.value, tenantId)
  }

  return getAutomationStatus(tenantId)
}

async function getActiveBlacklist(phone: string, tenantId = 'default'): Promise<AutomationDecision['blacklist']> {
  const [row] = await db
    .select()
    .from(automationBlacklist)
    .where(and(eq(automationBlacklist.tenant_id, tenantId), eq(automationBlacklist.phone, phone), gt(automationBlacklist.expires_at, new Date())))
    .limit(1)

  return {
    active: Boolean(row),
    reason: row?.reason ?? null,
    expires_at: row?.expires_at ?? null
  }
}

async function cleanupExpiredBlacklist(phone: string, tenantId = 'default'): Promise<void> {
  const [row] = await db
    .select()
    .from(automationBlacklist)
    .where(and(eq(automationBlacklist.tenant_id, tenantId), eq(automationBlacklist.phone, phone)))
    .limit(1)
  if (row?.expires_at && row.expires_at.getTime() <= Date.now()) {
    await db.delete(automationBlacklist).where(and(eq(automationBlacklist.tenant_id, tenantId), eq(automationBlacklist.phone, phone)))
  }
}

async function getAutomationSchedule(tenantId = 'default'): Promise<AutomationSchedule> {
  const [enabled, start, end, timezone] = await Promise.all([
    getSettingValue('automation_schedule_enabled', 'false', tenantId),
    getSettingValue('automation_schedule_start', '18:00', tenantId),
    getSettingValue('automation_schedule_end', '09:00', tenantId),
    getSettingValue('automation_schedule_timezone', 'America/Sao_Paulo', tenantId)
  ])
  const nowMinutes = getCurrentMinutesInTimezone(timezone)
  return {
    enabled: enabled.trim().toLowerCase() === 'true',
    start,
    end,
    timezone,
    now_minutes: nowMinutes,
    inside_window: isInsideWindow(nowMinutes, parseTimeToMinutes(start), parseTimeToMinutes(end))
  }
}

function getCurrentMinutesInTimezone(timezone: string): number {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function parseTimeToMinutes(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return 0
  const hour = Math.min(23, Math.max(0, Number(match[1])))
  const minute = Math.min(59, Math.max(0, Number(match[2])))
  return hour * 60 + minute
}

function isInsideWindow(now: number, start: number, end: number): boolean {
  if (start === end) return true
  if (start < end) return now >= start && now < end
  return now >= start || now < end
}

export async function getSettingValue(key: string, fallback = '', tenantId = 'default'): Promise<string> {
  const [setting] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
    .limit(1)
  return setting?.value ?? fallback
}

export async function upsertSetting(key: string, value: string, tenantId = 'default', description?: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
    .limit(1)
  if (existing) {
    await db
      .update(settings)
      .set({ value, updated_at: new Date() })
      .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
    return
  }

  await db.insert(settings).values({ key, tenant_id: tenantId, value, description, updated_at: new Date() })
}
