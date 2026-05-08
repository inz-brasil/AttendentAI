// human-takeover.ts — Gerencia pausa automática quando atendimento humano assume
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { automationBlacklist, settings } from '../db/schema'

export interface HumanTakeoverState {
  active: boolean
  expiresAt: Date | null
}

const DEFAULT_PAUSE_MINUTES = 120

/**
 * Ativa pausa de atendimento humano com TTL configurável.
 * @param phone Telefone normalizado.
 * @param source Origem da detecção.
 * @returns Expiração da pausa.
 */
export async function activateHumanTakeoverPause(
  phone: string,
  source = 'evolution'
): Promise<{ phone: string; expiresAt: Date }> {
  const minutes = await getHumanTakeoverPauseMinutes()
  const expiresAt = new Date(Date.now() + minutes * 60_000)
  const [existing] = await db.select().from(automationBlacklist).where(eq(automationBlacklist.phone, phone)).limit(1)

  if (existing) {
    await db
      .update(automationBlacklist)
      .set({ reason: 'human_takeover', source, expires_at: expiresAt, updated_at: new Date() })
      .where(eq(automationBlacklist.phone, phone))
  } else {
    await db.insert(automationBlacklist).values({ phone, reason: 'human_takeover', source, expires_at: expiresAt })
  }

  return { phone, expiresAt }
}

/**
 * Consulta pausa de atendimento humano ativa e limpa expirada.
 * @param phone Telefone normalizado.
 * @returns Estado da pausa.
 */
export async function getHumanTakeoverState(phone: string): Promise<HumanTakeoverState> {
  const [row] = await db.select().from(automationBlacklist).where(eq(automationBlacklist.phone, phone)).limit(1)
  if (row?.reason !== 'human_takeover') {
    return { active: false, expiresAt: null }
  }

  if (!row.expires_at || row.expires_at.getTime() <= Date.now()) {
    await db.delete(automationBlacklist).where(eq(automationBlacklist.phone, phone))
    return { active: false, expiresAt: null }
  }

  return { active: true, expiresAt: row.expires_at }
}

/**
 * Lê o TTL configurado para pausa humana.
 * @returns Minutos de pausa.
 */
export async function getHumanTakeoverPauseMinutes(): Promise<number> {
  const raw = await getFirstSettingValue([
    'human_takeover_pause_minutes',
    'automation_blacklist_default_minutes'
  ], String(DEFAULT_PAUSE_MINUTES))
  const minutes = Number(raw)
  return Math.max(1, Number.isFinite(minutes) ? minutes : DEFAULT_PAUSE_MINUTES)
}

async function getFirstSettingValue(keys: string[], fallback: string, tenantId = 'default'): Promise<string> {
  for (const key of keys) {
    const [setting] = await db
      .select()
      .from(settings)
      .where(and(eq(settings.tenant_id, tenantId), eq(settings.key, key)))
      .limit(1)
    if (setting?.value) {
      return setting.value
    }
  }

  return fallback
}
