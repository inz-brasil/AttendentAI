// wacli.ts — Expõe status e pareamento QR do WhatsApp CLI para o dashboard
import { mkdir } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSettingValue, upsertSetting } from '../automation/control'
import { WacliSyncService } from '../wacli/sync-service'

type ManagedProcess = ReturnType<typeof Bun.spawn>

interface ProcessState {
  process: ManagedProcess | null
  output: string[]
  startedAt: string | null
  exitedAt: string | null
  exitCode: number | null
  error: string | null
}

const processNameSchema = z.object({ name: z.enum(['auth', 'sync']) })
const backfillBodySchema = z.object({
  tenant_id: z.string().min(1).default('default'),
  phone: z.string().optional(),
  chat_jid: z.string().optional(),
  requests: z.number().int().min(1).max(20).default(1),
  count: z.number().int().min(1).max(200).default(50)
}).refine((value) => Boolean(value.phone?.trim() || value.chat_jid?.trim()), {
  message: 'phone ou chat_jid é obrigatório'
})
const maxOutputChars = 12000
const authState: ProcessState = createProcessState()
const syncState: ProcessState = createProcessState()

/**
 * Registra endpoints de /api/wacli.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerWacliRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/wacli/status', async () => {
    const config = await getWacliConfig()
    const doctor = await runWacli(config.command, withStore(config.store, ['doctor', '--json']), 15000)
    const authenticated = isDoctorAuthenticated(doctor.stdout)
    const enabled = config.enabled || authenticated

    if (authenticated && !config.enabled) {
      await upsertSetting('wacli_enabled', 'true')
    }

    return {
      installed: doctor.spawned,
      enabled,
      command: config.command,
      store: config.store,
      auth_running: isRunning(authState),
      sync_running: isRunning(syncState),
      doctor: doctor.success ? doctor.stdout : null,
      error: doctor.success ? null : doctor.stderr || doctor.error
    }
  })

  app.post('/api/wacli/auth/start', async (request) => {
    const config = await getWacliConfig()
    if (isRunning(authState)) {
      return { success: true, status: serializeState(authState) }
    }

    await ensureStore(config.store)
    startManagedProcess(authState, config.command, withStore(config.store, ['auth']), request.log)
    return { success: true, status: serializeState(authState) }
  })

  app.get('/api/wacli/auth/output', async () => serializeState(authState))

  app.post('/api/wacli/:name/stop', async (request) => {
    const params = processNameSchema.parse(request.params)
    stopProcess(params.name === 'auth' ? authState : syncState)
    return { success: true }
  })

  app.post('/api/wacli/sync/start', async (request, reply) => {
    const config = await getWacliConfig()
    if (isRunning(syncState)) {
      return reply.code(409).send({ error: 'Sincronização já em andamento', code: 'WACLI_SYNC_RUNNING' })
    }

    await ensureStore(config.store)
    startManagedProcess(syncState, config.command, withStore(config.store, ['sync', '--follow']), request.log)
    return { success: true, status: serializeState(syncState) }
  })

  app.get('/api/wacli/sync/output', async () => serializeState(syncState))

  app.post('/api/wacli/backfill', async (request) => {
    const body = backfillBodySchema.parse(request.body ?? {})
    const service = new WacliSyncService()
    return service.sync({
      tenantId: body.tenant_id,
      phone: body.phone?.replace(/\D/g, '') || body.chat_jid || '',
      remoteJid: body.chat_jid ?? null,
      requests: body.requests,
      count: body.count
    })
  })

  app.post('/api/wacli/enable', async () => {
    await upsertSetting('wacli_enabled', 'true')
    return { success: true }
  })

  app.post('/api/wacli/disable', async () => {
    await upsertSetting('wacli_enabled', 'false')
    return { success: true }
  })
}

function createProcessState(): ProcessState {
  return {
    process: null,
    output: [],
    startedAt: null,
    exitedAt: null,
    exitCode: null,
    error: null
  }
}

async function getWacliConfig(): Promise<{ enabled: boolean; command: string; store: string }> {
  const [enabled, command, store] = await Promise.all([
    getSettingValue('wacli_enabled', 'false'),
    getSettingValue('wacli_command', '/usr/local/bin/wacli'),
    getSettingValue('wacli_store', '/data/wacli')
  ])

  return {
    enabled: enabled.trim().toLowerCase() === 'true',
    command: command.trim() || '/usr/local/bin/wacli',
    store: store.trim() || '/data/wacli'
  }
}

function withStore(store: string, args: string[]): string[] {
  return ['--store', store, ...args]
}

async function ensureStore(store: string): Promise<void> {
  await mkdir(store, { recursive: true })
}

function isRunning(state: ProcessState): boolean {
  return state.process !== null && state.exitCode === null
}

function startManagedProcess(
  state: ProcessState,
  command: string,
  args: string[],
  log: FastifyInstance['log']
): void {
  resetState(state)
  const proc = Bun.spawn([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      WACLI_DEVICE_LABEL: process.env.WACLI_DEVICE_LABEL ?? 'AttendentAI',
      WACLI_DEVICE_PLATFORM: process.env.WACLI_DEVICE_PLATFORM ?? 'CHROME'
    }
  })

  state.process = proc
  state.startedAt = new Date().toISOString()
  readProcessStream(state, proc.stdout, 'stdout', log).catch((error: unknown) => {
    appendOutput(state, `\n[stdout error] ${getErrorMessage(error)}`)
  })
  readProcessStream(state, proc.stderr, 'stderr', log).catch((error: unknown) => {
    appendOutput(state, `\n[stderr error] ${getErrorMessage(error)}`)
  })

  proc.exited
    .then((code) => {
      state.exitCode = code
      state.exitedAt = new Date().toISOString()
      state.process = null
      appendOutput(state, `\n[process exited: ${code}]`)
    })
    .catch((error: unknown) => {
      state.error = getErrorMessage(error)
      state.exitedAt = new Date().toISOString()
      state.process = null
      appendOutput(state, `\n[process error] ${state.error}`)
    })
}

function resetState(state: ProcessState): void {
  stopProcess(state)
  state.output = []
  state.startedAt = null
  state.exitedAt = null
  state.exitCode = null
  state.error = null
}

function stopProcess(state: ProcessState): void {
  if (state.process) {
    state.process.kill()
  }
  state.process = null
}

async function readProcessStream(
  state: ProcessState,
  stream: ReadableStream<Uint8Array>,
  source: 'stdout' | 'stderr',
  log: FastifyInstance['log']
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    const text = decoder.decode(chunk.value, { stream: true })
    if (text) {
      appendOutput(state, text)
      log.info({ source, chars: text.length }, 'wacli output received')
    }
  }
}

function appendOutput(state: ProcessState, text: string): void {
  state.output.push(text)
  const joined = state.output.join('')
  if (joined.length <= maxOutputChars) return
  state.output = [joined.slice(-maxOutputChars)]
}

function serializeState(state: ProcessState): {
  running: boolean
  output: string
  started_at: string | null
  exited_at: string | null
  exit_code: number | null
  error: string | null
} {
  return {
    running: isRunning(state),
    output: state.output.join('').slice(-maxOutputChars),
    started_at: state.startedAt,
    exited_at: state.exitedAt,
    exit_code: state.exitCode,
    error: state.error
  }
}

async function runWacli(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ spawned: boolean; success: boolean; stdout: unknown; stderr: string; error: string | null }> {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])
    clearTimeout(timer)

    return {
      spawned: true,
      success: exitCode === 0,
      stdout: parseMaybeJson(stdout),
      stderr: stderr.slice(0, 4000),
      error: null
    }
  } catch (error: unknown) {
    return {
      spawned: false,
      success: false,
      stdout: null,
      stderr: '',
      error: getErrorMessage(error)
    }
  }
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed.slice(0, 8000)
  }
}

function isDoctorAuthenticated(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = (value as { data?: unknown }).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  return (data as { authenticated?: unknown }).authenticated === true
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro desconhecido'
}
