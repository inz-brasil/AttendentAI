// schedule.ts — Avalia janela determinística de atendimento automático
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { settings } from '../db/schema'

export interface ScheduleDecision {
  enabled: boolean
  insideWindow: boolean
  replyOutsideSchedule: boolean
  timezone: string
  openTime: string
  closeTime: string
  days: string[]
  nowMinutes: number
  day: string
}

const defaultDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/**
 * Avalia horário de atendimento automático.
 * @param now Data atual, injetável para testes.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Decisão da agenda.
 */
export async function getScheduleDecision(now = new Date(), tenantId = 'default'): Promise<ScheduleDecision> {
  const [enabledRaw, timezone, openTime, closeTime, daysRaw, replyOutsideRaw] = await Promise.all([
    getFirstSettingValue(['schedule_enabled', 'automation_schedule_enabled'], 'false', tenantId),
    getFirstSettingValue(['schedule_timezone', 'automation_schedule_timezone'], 'America/Sao_Paulo', tenantId),
    getFirstSettingValue(['schedule_open_time', 'automation_schedule_start'], '18:00', tenantId),
    getFirstSettingValue(['schedule_close_time', 'automation_schedule_end'], '09:00', tenantId),
    getFirstSettingValue(['schedule_days'], JSON.stringify(defaultDays), tenantId),
    getFirstSettingValue(['reply_outside_schedule'], 'false', tenantId)
  ])
  const day = getDayKey(now, timezone)
  const days = parseDays(daysRaw)
  const nowMinutes = getCurrentMinutesInTimezone(now, timezone)
  const allowedDay = days.includes(day)
  const insideTime = isInsideWindow(nowMinutes, parseTimeToMinutes(openTime), parseTimeToMinutes(closeTime))

  return {
    enabled: parseBoolean(enabledRaw),
    insideWindow: allowedDay && insideTime,
    replyOutsideSchedule: parseBoolean(replyOutsideRaw),
    timezone,
    openTime,
    closeTime,
    days,
    nowMinutes,
    day
  }
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === 'true'
}

function parseDays(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) {
    return defaultDays
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string').map(normalizeDay).filter(Boolean)
    }
  } catch {
    // Também aceita lista simples separada por vírgula, ponto e vírgula ou linha.
  }

  const days = trimmed.split(/[\n,;]/).map(normalizeDay).filter(Boolean)
  return days.length > 0 ? days : defaultDays
}

function normalizeDay(value: string): string {
  const normalized = value.trim().slice(0, 3).toLowerCase()
  if (normalized === 'seg') return 'mon'
  if (normalized === 'ter') return 'tue'
  if (normalized === 'qua') return 'wed'
  if (normalized === 'qui') return 'thu'
  if (normalized === 'sex') return 'fri'
  if (normalized === 'sab' || normalized === 'sáb') return 'sat'
  if (normalized === 'dom') return 'sun'
  return defaultDays.includes(normalized) ? normalized : ''
}

function getCurrentMinutesInTimezone(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function getDayKey(now: Date, timezone: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short'
  }).format(now)
  return weekday.slice(0, 3).toLowerCase()
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

async function getFirstSettingValue(keys: string[], fallback: string, tenantId = 'default'): Promise<string> {
  for (const key of keys) {
    const [setting] = await db.select().from(settings).where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key))).limit(1)
    if (setting?.value) {
      return setting.value
    }
  }

  return fallback
}
