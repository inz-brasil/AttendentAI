// settings.ts — Centraliza configurações operacionais do MCP Google Calendar
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { settings } from '../../db/schema'

export const DEFAULT_GOOGLE_CALENDAR_ID = 'primary'
export const GOOGLE_CALENDAR_ID_SETTING = 'google_calendar_id'
export const GOOGLE_CALENDAR_EVENT_DESCRIPTION_TEMPLATE_SETTING = 'google_calendar_event_description_template'
export const DEFAULT_EVENT_DESCRIPTION_TEMPLATE = [
  'Nome: {lead_name}',
  'WhatsApp: {lead_phone}',
  'Serviço de interesse: {service_interest}',
  'Motivo da reunião: {meeting_reason}',
  'Observações: {notes}'
].join('\n')

export interface GoogleCalendarSettings {
  calendarId: string
  eventDescriptionTemplate: string
}

export interface EventDescriptionInput {
  lead_name?: string | undefined
  lead_phone?: string | undefined
  service_interest?: string | undefined
  meeting_reason?: string | undefined
  notes?: string | undefined
}

async function getSettingValue(key: string): Promise<string | null> {
  const [setting] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  return setting?.value?.trim() || null
}

/**
 * Carrega agenda padrão e template de descrição do Google Calendar.
 * @returns Configuração do MCP Calendar com fallback seguro.
 */
export async function getGoogleCalendarSettings(): Promise<GoogleCalendarSettings> {
  const [calendarId, eventDescriptionTemplate] = await Promise.all([
    getSettingValue(GOOGLE_CALENDAR_ID_SETTING),
    getSettingValue(GOOGLE_CALENDAR_EVENT_DESCRIPTION_TEMPLATE_SETTING)
  ])

  return {
    calendarId: calendarId ?? DEFAULT_GOOGLE_CALENDAR_ID,
    eventDescriptionTemplate: eventDescriptionTemplate ?? DEFAULT_EVENT_DESCRIPTION_TEMPLATE
  }
}

/**
 * Renderiza a descrição padrão do evento com os dados conhecidos do lead.
 * @param template Template salvo em settings.
 * @param input Dados coletados durante o atendimento.
 * @returns Descrição pronta para gravar no Calendar.
 */
export function renderEventDescription(template: string, input: EventDescriptionInput): string {
  const values: Record<keyof EventDescriptionInput, string> = {
    lead_name: input.lead_name ?? 'Não informado',
    lead_phone: input.lead_phone ?? 'Não informado',
    service_interest: input.service_interest ?? 'Não informado',
    meeting_reason: input.meeting_reason ?? 'Não informado',
    notes: input.notes ?? 'Não informado'
  }

  return Object.entries(values).reduce(
    (description, [key, value]) => description.replaceAll(`{${key}}`, value),
    template
  )
}
