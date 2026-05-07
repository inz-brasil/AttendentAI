// system-control.ts — Tools administrativas para controlar automação do AttendentAI
import { z } from 'zod'
import {
  activateAutomationBlacklist,
  deactivateAutomationBlacklist,
  getAutomationStatus,
  updateAutomationSettings
} from '../automation/control'

const systemControlSchema = z.object({
  action: z.enum(['status', 'enable_agent', 'disable_agent', 'set_schedule', 'add_blacklist', 'remove_blacklist']),
  phone: z.string().optional(),
  reason: z.string().optional(),
  schedule_enabled: z.boolean().optional(),
  schedule_start: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  schedule_end: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
  blacklist_default_minutes: z.number().int().min(1).max(10080).optional()
})

/**
 * Executa ações administrativas permitidas pelo assistente interno.
 * @param rawInput Argumentos da tool.
 * @returns Resultado auditável da ação.
 */
export async function executeSystemControlTool(rawInput: unknown): Promise<Record<string, unknown>> {
  const input = systemControlSchema.parse(rawInput ?? {})

  if (input.action === 'status') {
    return getAutomationStatus()
  }

  if (input.action === 'enable_agent') {
    return updateAutomationSettings({ enabled: true })
  }

  if (input.action === 'disable_agent') {
    return updateAutomationSettings({ enabled: false })
  }

  if (input.action === 'set_schedule') {
    return updateAutomationSettings({
      schedule_enabled: input.schedule_enabled,
      schedule_start: input.schedule_start,
      schedule_end: input.schedule_end,
      timezone: input.timezone,
      blacklist_default_minutes: input.blacklist_default_minutes
    })
  }

  if (input.action === 'add_blacklist') {
    if (!input.phone) return { success: false, error: 'phone é obrigatório para add_blacklist' }
    const result = await activateAutomationBlacklist(input.phone, input.reason ?? 'manual_admin', 'internal-assistant')
    return { success: true, ...result }
  }

  if (input.action === 'remove_blacklist') {
    if (!input.phone) return { success: false, error: 'phone é obrigatório para remove_blacklist' }
    await deactivateAutomationBlacklist(input.phone)
    return { success: true, phone: input.phone }
  }

  return { success: false, error: 'Ação não suportada' }
}
