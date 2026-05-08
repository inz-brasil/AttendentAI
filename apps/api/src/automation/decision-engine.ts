// decision-engine.ts — Decide de forma determinística se a automação deve processar e responder
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { settings } from '../db/schema'
import { traceEmitter } from '../observability/trace-emitter'
import type { TranscriptIngestResult } from '../transcript/ingestor'
import type { NormalizedWhatsappEvent } from '../webhook/evolution-normalizer'
import { getBlacklistState } from './blacklist'
import { getHumanTakeoverState } from './human-takeover'
import { getScheduleDecision } from './schedule'

export type AutomationDecisionReason =
  | 'allowed'
  | 'blacklist'
  | 'outside_schedule'
  | 'manual_pause'
  | 'human_takeover'
  | 'group_ignored'
  | 'bot_echo'
  | 'unsupported_event'
  | 'automation_disabled'

export interface AutomationDecision {
  shouldProcess: boolean
  shouldReply: boolean
  reason: AutomationDecisionReason
  pauseExpiresAt?: Date | null
}

export interface AutomationDecisionInput {
  tenantId: string
  event: NormalizedWhatsappEvent
  transcript?: TranscriptIngestResult | null
}

/**
 * Avalia automação antes de qualquer chamada de IA, preservando o transcript já salvo.
 */
export class AutomationDecisionEngine {
  /**
   * Decide se a mensagem deve seguir para o orquestrador e se deve responder.
   * @param input Evento normalizado e resultado opcional de transcript.
   * @returns Decisão determinística.
   */
  async decide(input: AutomationDecisionInput): Promise<AutomationDecision> {
    const decision = await this.evaluate(input)
    await traceEmitter.emit('automation_decision', {
      tenant_id: input.tenantId,
      phone: input.event.phone,
      status: decision.reason === 'allowed' ? 'ok' : 'ignored',
      data: {
        reason: decision.reason,
        should_process: decision.shouldProcess,
        should_reply: decision.shouldReply,
        pause_expires_at: decision.pauseExpiresAt?.toISOString() ?? null,
        from_me: input.event.fromMe,
        is_group: input.event.isGroup,
        source_event: input.event.event,
        transcript_status: input.transcript?.status ?? null,
        transcript_next_action: input.transcript?.nextAction ?? null
      }
    })

    return decision
  }

  private async evaluate(input: AutomationDecisionInput): Promise<AutomationDecision> {
    if (!(await this.isAutomationEnabled(input.tenantId))) {
      return blocked('automation_disabled')
    }

    const blacklist = await getBlacklistState(input.event.phone, input.tenantId)
    if (blacklist.active && blacklist.reason === 'blacklist') {
      return blocked('blacklist', blacklist.expiresAt)
    }

    if (blacklist.active && blacklist.reason === 'manual_pause') {
      return blocked('manual_pause', blacklist.expiresAt)
    }

    const humanTakeover = await getHumanTakeoverState(input.event.phone, input.tenantId)
    if (humanTakeover.active) {
      return blocked('human_takeover', humanTakeover.expiresAt)
    }

    const schedule = await getScheduleDecision(new Date(), input.tenantId)
    if (schedule.enabled && !schedule.insideWindow && !schedule.replyOutsideSchedule) {
      return blocked('outside_schedule')
    }

    if (input.event.isGroup) {
      return blocked('group_ignored')
    }

    if (this.isBotEcho(input)) {
      return blocked('bot_echo')
    }

    if (input.event.event !== 'messages.upsert') {
      return blocked('unsupported_event')
    }

    return { shouldProcess: true, shouldReply: true, reason: 'allowed', pauseExpiresAt: null }
  }

  private isBotEcho(input: AutomationDecisionInput): boolean {
    return input.transcript?.nextAction === 'update_existing' || input.transcript?.classification.senderType === 'bot'
  }

  private async isAutomationEnabled(tenantId = 'default'): Promise<boolean> {
    const [setting] = await db.select().from(settings).where(and(eq(settings.tenant_id, tenantId), eq(settings.key, 'automation_enabled'))).limit(1)
    return (setting?.value ?? 'true').trim().toLowerCase() !== 'false'
  }
}

function blocked(reason: AutomationDecisionReason, pauseExpiresAt: Date | null = null): AutomationDecision {
  return { shouldProcess: false, shouldReply: false, reason, pauseExpiresAt }
}
