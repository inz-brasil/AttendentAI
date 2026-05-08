// blacklist.ts — Consulta bloqueios manuais de automação por telefone
import { and, eq, gt, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { automationBlacklist, settings } from '../db/schema'

export interface BlacklistState {
  active: boolean
  reason: 'blacklist' | 'manual_pause' | null
  expiresAt: Date | null
}

const blacklistReasons = ['blacklist', 'manual_blacklist', 'manual_admin']
const manualPauseReasons = ['manual_pause']

/**
 * Verifica bloqueio manual ou blacklist configurada para um telefone.
 * @param phone Telefone normalizado.
 * @returns Estado de blacklist/manual pause.
 */
export async function getBlacklistState(phone: string): Promise<BlacklistState> {
  if (await isPhoneInConfiguredBlacklist(phone)) {
    return { active: true, reason: 'blacklist', expiresAt: null }
  }

  const now = new Date()
  await cleanupExpiredManualBlocks(phone, now)
  const [row] = await db
    .select()
    .from(automationBlacklist)
    .where(and(
      eq(automationBlacklist.phone, phone),
      gt(automationBlacklist.expires_at, now),
      inArray(automationBlacklist.reason, [...blacklistReasons, ...manualPauseReasons])
    ))
    .limit(1)

  if (!row) {
    return { active: false, reason: null, expiresAt: null }
  }

  const reason = manualPauseReasons.includes(row.reason ?? '') ? 'manual_pause' : 'blacklist'
  return { active: true, reason, expiresAt: row.expires_at ?? null }
}

async function isPhoneInConfiguredBlacklist(phone: string): Promise<boolean> {
  const configured = await getSettingValue('blacklist', '')
  const phones = parsePhoneList(configured)
  return phones.includes(phone)
}

async function cleanupExpiredManualBlocks(phone: string, now: Date): Promise<void> {
  const rows = await db
    .select()
    .from(automationBlacklist)
    .where(and(
      eq(automationBlacklist.phone, phone),
      inArray(automationBlacklist.reason, [...blacklistReasons, ...manualPauseReasons])
    ))

  for (const row of rows) {
    if (row.expires_at && row.expires_at.getTime() <= now.getTime()) {
      await db.delete(automationBlacklist).where(eq(automationBlacklist.phone, row.phone))
    }
  }
}

function parsePhoneList(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/\D/g, ''))
        .filter(Boolean)
    }
  } catch {
    // Também aceita lista simples separada por vírgula, ponto e vírgula ou linha.
  }

  return trimmed
    .split(/[\n,;]/)
    .map((item) => item.replace(/\D/g, ''))
    .filter(Boolean)
}

async function getSettingValue(key: string, fallback: string, tenantId = 'default'): Promise<string> {
  const [setting] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
    .limit(1)
  return setting?.value ?? fallback
}
