// tools.ts — Implementa tools MCP do Google Calendar com googleapis
import { google, calendar_v3 } from 'googleapis'
import { z } from 'zod'
import { getValidAccessToken } from './token-manager'

type BusySlot = calendar_v3.Schema$TimePeriod
type CalendarToolResult = Record<string, unknown>

const businessStartHour = 8
const businessEndHour = 18

export const googleCalendarTools = [
  {
    name: 'verificar_disponibilidade',
    description: 'Verifica horários livres em uma data.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data em YYYY-MM-DD.' },
        duration_minutes: { type: 'number', description: 'Duração do compromisso em minutos.' }
      },
      required: ['date', 'duration_minutes']
    }
  },
  {
    name: 'listar_eventos',
    description: 'Lista eventos de hoje ou de uma data específica.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data opcional em YYYY-MM-DD.' },
        max_results: { type: 'number', description: 'Quantidade máxima de eventos.' }
      }
    }
  },
  {
    name: 'criar_evento',
    description: 'Cria evento no Google Calendar.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'Data em YYYY-MM-DD.' },
        time: { type: 'string', description: 'Hora em HH:mm.' },
        duration_minutes: { type: 'number' },
        attendee_email: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['title', 'date', 'time', 'duration_minutes']
    }
  },
  {
    name: 'cancelar_evento',
    description: 'Cancela evento pelo ID.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'proximo_horario_livre',
    description: 'Sugere o próximo horário livre.',
    inputSchema: {
      type: 'object',
      properties: {
        duration_minutes: { type: 'number' },
        after_date: { type: 'string', description: 'Data inicial opcional em YYYY-MM-DD.' }
      },
      required: ['duration_minutes']
    }
  }
]

const availabilitySchema = z.object({ date: z.string().min(1), duration_minutes: z.coerce.number().int().positive() })
const listEventsSchema = z.object({ date: z.string().optional(), max_results: z.coerce.number().int().positive().max(50).default(10) })
const createEventSchema = z.object({
  title: z.string().min(1),
  date: z.string().min(1),
  time: z.string().min(1),
  duration_minutes: z.coerce.number().int().positive(),
  attendee_email: z.string().email().optional(),
  description: z.string().optional()
})
const cancelEventSchema = z.object({ event_id: z.string().min(1) })
const nextSlotSchema = z.object({ duration_minutes: z.coerce.number().int().positive(), after_date: z.string().optional() })
const freeSlotsSchema = z.array(z.string())

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function dayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00`)
  start.setHours(businessStartHour, 0, 0, 0)
  const end = new Date(`${date}T00:00:00`)
  end.setHours(businessEndHour, 0, 0, 0)
  return { start, end }
}

function calculateFreeSlots(start: Date, end: Date, busySlots: BusySlot[], durationMinutes: number): Date[] {
  const durationMs = durationMinutes * 60 * 1000
  const busy = busySlots
    .map((slot) => ({
      start: slot.start ? new Date(slot.start).getTime() : 0,
      end: slot.end ? new Date(slot.end).getTime() : 0
    }))
    .filter((slot) => slot.start > 0 && slot.end > 0)
    .sort((a, b) => a.start - b.start)

  const slots: Date[] = []
  for (let cursor = start.getTime(); cursor + durationMs <= end.getTime(); cursor += 30 * 60 * 1000) {
    const candidateEnd = cursor + durationMs
    const conflicts = busy.some((slot) => cursor < slot.end && candidateEnd > slot.start)
    if (!conflicts) slots.push(new Date(cursor))
  }
  return slots
}

async function calendarClient(mcpServerId: string) {
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: await getValidAccessToken(mcpServerId) })
  return google.calendar({ version: 'v3', auth })
}

/**
 * Verifica horários livres em uma data.
 * @param args Argumentos da tool.
 * @param mcpServerId ID do servidor MCP Google Calendar.
 * @returns Horários livres e quantidade de eventos ocupados.
 */
export async function verificarDisponibilidade(args: unknown, mcpServerId: string): Promise<CalendarToolResult> {
  const parsed = availabilitySchema.parse(args)
  const calendar = await calendarClient(mcpServerId)
  const { start, end } = dayBounds(parsed.date)
  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: 'primary' }]
    }
  })
  const busySlots = freeBusy.data.calendars?.primary?.busy ?? []
  const freeSlots = calculateFreeSlots(start, end, busySlots, parsed.duration_minutes)
  return {
    data: parsed.date,
    horarios_livres: freeSlots.map(formatDateTime),
    eventos_ocupados: busySlots.length
  }
}

/**
 * Lista eventos de uma data no calendário primário.
 * @param args Argumentos da tool.
 * @param mcpServerId ID do servidor MCP Google Calendar.
 * @returns Lista de eventos formatados em português.
 */
export async function listarEventos(args: unknown, mcpServerId: string): Promise<CalendarToolResult> {
  const parsed = listEventsSchema.parse(args)
  const calendar = await calendarClient(mcpServerId)
  const date = parsed.date ?? new Date().toISOString().slice(0, 10)
  const { start, end } = dayBounds(date)
  const events = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    maxResults: parsed.max_results,
    singleEvents: true,
    orderBy: 'startTime'
  })
  return {
    eventos: (events.data.items ?? []).map((event) => ({
      id: event.id,
      titulo: event.summary ?? 'Sem título',
      inicio: event.start?.dateTime ? formatDateTime(new Date(event.start.dateTime)) : event.start?.date,
      fim: event.end?.dateTime ? formatDateTime(new Date(event.end.dateTime)) : event.end?.date
    }))
  }
}

/**
 * Cria um evento no Google Calendar.
 * @param args Argumentos da tool.
 * @param mcpServerId ID do servidor MCP Google Calendar.
 * @returns Dados do evento criado.
 */
export async function criarEvento(args: unknown, mcpServerId: string): Promise<CalendarToolResult> {
  const parsed = createEventSchema.parse(args)
  const calendar = await calendarClient(mcpServerId)
  const start = new Date(`${parsed.date}T${parsed.time}:00`)
  const end = new Date(start.getTime() + parsed.duration_minutes * 60 * 1000)
  const requestBody: calendar_v3.Schema$Event = {
    summary: parsed.title,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() }
  }

  if (parsed.description) {
    requestBody.description = parsed.description
  }

  if (parsed.attendee_email) {
    requestBody.attendees = [{ email: parsed.attendee_email }]
  }

  const event = await calendar.events.insert({
    calendarId: 'primary',
    requestBody
  })
  return {
    status: 'criado',
    event_id: event.data.id,
    titulo: event.data.summary,
    inicio: formatDateTime(start),
    fim: formatDateTime(end)
  }
}

/**
 * Cancela um evento pelo ID.
 * @param args Argumentos da tool.
 * @param mcpServerId ID do servidor MCP Google Calendar.
 * @returns Status do cancelamento.
 */
export async function cancelarEvento(args: unknown, mcpServerId: string): Promise<CalendarToolResult> {
  const parsed = cancelEventSchema.parse(args)
  const calendar = await calendarClient(mcpServerId)
  await calendar.events.delete({ calendarId: 'primary', eventId: parsed.event_id })
  return { status: 'cancelado', event_id: parsed.event_id }
}

/**
 * Busca o próximo horário livre nos próximos 14 dias.
 * @param args Argumentos da tool.
 * @param mcpServerId ID do servidor MCP Google Calendar.
 * @returns Primeiro horário livre encontrado.
 */
export async function proximoHorarioLivre(args: unknown, mcpServerId: string): Promise<CalendarToolResult> {
  const parsed = nextSlotSchema.parse(args)
  for (let offset = 0; offset < 14; offset += 1) {
    const base = parsed.after_date ? new Date(`${parsed.after_date}T00:00:00`) : new Date()
    base.setDate(base.getDate() + offset)
    const date = base.toISOString().slice(0, 10)
    const availability = await verificarDisponibilidade({ date, duration_minutes: parsed.duration_minutes }, mcpServerId)
    const slots = freeSlotsSchema.parse(availability.horarios_livres)
    if (slots.length > 0) return { proximo_horario_livre: slots[0], data: date }
  }
  return { proximo_horario_livre: null, mensagem: 'Nenhum horário livre encontrado nos próximos 14 dias.' }
}

/**
 * Executa uma tool do Google Calendar por nome.
 * @param name Nome da tool.
 * @param args Argumentos recebidos do MCPClient.
 * @param mcpServerId ID do servidor MCP Google Calendar.
 * @returns Resultado da tool ou erro tratado.
 */
export async function executeGoogleCalendarTool(name: string, args: unknown, mcpServerId: string): Promise<CalendarToolResult> {
  try {
    switch (name) {
      case 'verificar_disponibilidade': return await verificarDisponibilidade(args, mcpServerId)
      case 'listar_eventos': return await listarEventos(args, mcpServerId)
      case 'criar_evento': return await criarEvento(args, mcpServerId)
      case 'cancelar_evento': return await cancelarEvento(args, mcpServerId)
      case 'proximo_horario_livre': return await proximoHorarioLivre(args, mcpServerId)
      default: return { erro: `Tool desconhecida: ${name}` }
    }
  } catch (error) {
    return {
      erro: error instanceof Error ? error.message : 'Erro ao acessar Google Calendar'
    }
  }
}
