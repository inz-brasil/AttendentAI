// platform-editor.ts — Tool administrativa auditada para melhorar agentes, skills e vault
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '../config/env'
import { db } from '../db/client'
import { agents, skills } from '../db/schema'
import { VaultManager } from '../vault-manager/manager'

const editableVaultFileSchema = z.enum(['memoria.md', 'historico.md', 'notas.md'])
const platformEditorSchema = z.object({
  action: z.enum([
    'list_agents',
    'read_agent',
    'update_agent_prompt',
    'list_skills',
    'read_skill',
    'update_skill',
    'write_vault',
    'append_vault',
    'write_global_vault',
    'append_global_vault'
  ]),
  apply: z.boolean().default(false),
  rationale: z.string().min(12).optional(),
  agent_id: z.string().optional(),
  skill_id: z.string().optional(),
  phone: z.string().optional(),
  filename: z.string().optional(),
  system_prompt: z.string().optional(),
  content: z.string().optional(),
  description: z.string().optional(),
  when_to_use: z.string().optional(),
  max_chars: z.number().int().min(500).max(12000).default(6000)
})

type PlatformEditorInput = z.infer<typeof platformEditorSchema>

/**
 * Executa ações administrativas de melhoria em agentes, skills e vault.
 * @param rawInput Argumentos vindos do assistente interno.
 * @returns Resultado auditável da leitura, simulação ou alteração.
 */
export async function executePlatformEditorTool(rawInput: unknown): Promise<Record<string, unknown>> {
  const input = platformEditorSchema.parse(rawInput ?? {})

  if (input.action === 'list_agents') return listAgents()
  if (input.action === 'read_agent') return readAgent(input)
  if (input.action === 'update_agent_prompt') return updateAgentPrompt(input)
  if (input.action === 'list_skills') return listSkills()
  if (input.action === 'read_skill') return readSkill(input)
  if (input.action === 'update_skill') return updateSkill(input)
  if (input.action === 'write_vault') return writeVault(input, 'write')
  if (input.action === 'append_vault') return writeVault(input, 'append')
  if (input.action === 'write_global_vault') return writeGlobalVault(input, 'write')
  if (input.action === 'append_global_vault') return writeGlobalVault(input, 'append')

  return { success: false, error: 'Ação não suportada' }
}

async function listAgents(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(agents).orderBy(desc(agents.updated_at)).limit(30)
  return {
    success: true,
    agents: rows.map((agent) => ({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      model: agent.model,
      active: agent.is_active,
      prompt_chars: agent.system_prompt?.length ?? 0,
      updated_at: agent.updated_at
    }))
  }
}

async function readAgent(input: PlatformEditorInput): Promise<Record<string, unknown>> {
  if (!input.agent_id) return missing('agent_id')
  const agent = await loadAgent(input.agent_id)
  if (!agent) return notFound('agent')

  return {
    success: true,
    agent: {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      is_active: agent.is_active,
      system_prompt: truncate(agent.system_prompt ?? '', input.max_chars)
    }
  }
}

async function updateAgentPrompt(input: PlatformEditorInput): Promise<Record<string, unknown>> {
  if (!input.agent_id) return missing('agent_id')
  if (!input.system_prompt) return missing('system_prompt')
  const blocked = requireApplyRationale(input)
  if (blocked) return blocked

  const agent = await loadAgent(input.agent_id)
  if (!agent) return notFound('agent')
  const previous = agent.system_prompt ?? ''

  if (input.apply) {
    await db
      .update(agents)
      .set({ system_prompt: input.system_prompt, updated_at: new Date() })
      .where(eq(agents.id, input.agent_id))
  }

  return mutationResult(input, 'agent.system_prompt', previous, input.system_prompt)
}

async function listSkills(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(skills).orderBy(desc(skills.updated_at)).limit(50)
  return {
    success: true,
    skills: rows.map((skill) => ({
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
      category: skill.category,
      priority: skill.priority,
      active: skill.is_active,
      content_chars: skill.content?.length ?? 0,
      updated_at: skill.updated_at
    }))
  }
}

async function readSkill(input: PlatformEditorInput): Promise<Record<string, unknown>> {
  if (!input.skill_id) return missing('skill_id')
  const skill = await loadSkill(input.skill_id)
  if (!skill) return notFound('skill')

  return {
    success: true,
    skill: {
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      category: skill.category,
      when_to_use: skill.when_to_use,
      priority: skill.priority,
      is_active: skill.is_active,
      content: truncate(skill.content ?? '', input.max_chars)
    }
  }
}

async function updateSkill(input: PlatformEditorInput): Promise<Record<string, unknown>> {
  if (!input.skill_id) return missing('skill_id')
  if (!input.content && !input.description && !input.when_to_use) {
    return { success: false, error: 'Informe content, description ou when_to_use para update_skill' }
  }
  const blocked = requireApplyRationale(input)
  if (blocked) return blocked

  const skill = await loadSkill(input.skill_id)
  if (!skill) return notFound('skill')
  const previous = {
    content: skill.content ?? '',
    description: skill.description ?? '',
    when_to_use: skill.when_to_use ?? ''
  }
  const next = {
    content: input.content ?? previous.content,
    description: input.description ?? previous.description,
    when_to_use: input.when_to_use ?? previous.when_to_use
  }

  if (input.apply) {
    await db
      .update(skills)
      .set({ ...next, updated_at: new Date() })
      .where(eq(skills.id, input.skill_id))
  }

  return {
    ...mutationResult(input, 'skill', JSON.stringify(previous), JSON.stringify(next)),
    changed_fields: Object.entries({
      content: input.content,
      description: input.description,
      when_to_use: input.when_to_use
    })
      .filter(([, value]) => typeof value === 'string')
      .map(([key]) => key)
  }
}

async function writeVault(input: PlatformEditorInput, mode: 'write' | 'append'): Promise<Record<string, unknown>> {
  if (!input.phone) return missing('phone')
  if (!input.content) return missing('content')
  const filename = resolveVaultFilename(input.filename, editableVaultFileSchema)
  if (typeof filename !== 'string') return filename
  const blocked = requireApplyRationale(input)
  if (blocked) return blocked

  const vault = new VaultManager(env.VAULT_PATH)
  const previous = await vault.read(input.phone, filename)
  const next = mode === 'append' ? appendMarkdown(previous, input.content) : input.content

  if (input.apply) {
    if (mode === 'append') {
      await vault.append(input.phone, filename, input.content)
    } else {
      await vault.write(input.phone, filename, input.content)
    }
  }

  return mutationResult(input, `vault.${filename}`, previous, next)
}

async function writeGlobalVault(input: PlatformEditorInput, mode: 'write' | 'append'): Promise<Record<string, unknown>> {
  if (!input.content) return missing('content')
  const filename = resolveVaultFilename(input.filename, z.string().regex(/^[a-zA-Z0-9._-]+\.md$/))
  if (typeof filename !== 'string') return filename
  const blocked = requireApplyRationale(input)
  if (blocked) return blocked

  const vault = new VaultManager(env.VAULT_PATH)
  const previous = await vault.readGlobal(filename)
  const next = mode === 'append' ? appendMarkdown(previous, input.content) : input.content

  if (input.apply) {
    if (mode === 'append') {
      await vault.writeGlobal(filename, next)
    } else {
      await vault.writeGlobal(filename, input.content)
    }
  }

  return mutationResult(input, `global_vault.${filename}`, previous, next)
}

async function loadAgent(id: string): Promise<typeof agents.$inferSelect | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1)
  return agent ?? null
}

async function loadSkill(id: string): Promise<typeof skills.$inferSelect | null> {
  const [skill] = await db.select().from(skills).where(eq(skills.id, id)).limit(1)
  return skill ?? null
}

function resolveVaultFilename(
  filename: string | undefined,
  schema: z.ZodType<string>
): string | Record<string, unknown> {
  const parsed = schema.safeParse(filename ?? 'memoria.md')
  if (!parsed.success) {
    return { success: false, error: 'filename inválido ou não permitido' }
  }
  return parsed.data
}

function requireApplyRationale(input: PlatformEditorInput): Record<string, unknown> | null {
  if (!input.rationale) {
    return { success: false, error: 'rationale é obrigatório para alterações' }
  }

  if (!input.apply) {
    return null
  }

  return null
}

function mutationResult(
  input: PlatformEditorInput,
  target: string,
  previous: string,
  next: string
): Record<string, unknown> {
  return {
    success: true,
    applied: input.apply,
    target,
    rationale: input.rationale,
    previous_chars: previous.length,
    next_chars: next.length,
    previous_preview: truncate(previous, 600),
    next_preview: truncate(next, 900),
    note: input.apply ? 'Alteração aplicada e auditada no trace da tool.' : 'Simulação pronta; use apply=true para salvar.'
  }
}

function appendMarkdown(previous: string, content: string): string {
  return previous.trim().length > 0 ? `${previous.trim()}\n\n${content.trim()}\n` : `${content.trim()}\n`
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n[truncado]` : value
}

function missing(field: string): Record<string, unknown> {
  return { success: false, error: `${field} é obrigatório` }
}

function notFound(entity: string): Record<string, unknown> {
  return { success: false, error: `${entity} não encontrado` }
}
