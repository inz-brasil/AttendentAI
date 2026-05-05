// loader.ts — Carrega skills ativas do banco para injeção em prompts
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { agentSkills, skills } from '../db/schema'

type Priority = 'high' | 'medium' | 'low'
type SkillRow = {
  id: string
  slug: string | null
  name: string
  description: string | null
  when_to_use: string | null
  priority: string | null
  content: string | null
  order: number | null
}

const priorityRank: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2
}
const SKILL_CACHE_TTL_MS = 5 * 60 * 1000
const rowsCache = new Map<string, { rows: SkillRow[]; expiresAt: number }>()

function rankPriority(priority: string | null): number {
  return priorityRank[(priority ?? 'medium') as Priority] ?? priorityRank.medium
}

function formatSkill(skill: {
  id: string
  slug: string | null
  name: string
  description: string | null
  when_to_use: string | null
  priority: string | null
  content: string | null
}): string {
  return [
    `## Skill: ${skill.name} (${skill.slug ?? skill.id})`,
    skill.description ? `Descrição: ${skill.description}` : null,
    skill.when_to_use ? `Quando usar: ${skill.when_to_use}` : null,
    `Prioridade: ${skill.priority ?? 'medium'}`,
    skill.content
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n')
}

function summarizeSkillContent(content: string | null): string {
  if (!content?.trim()) return ''
  return content
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900)
}

export class SkillsLoader {
  /**
   * Carrega metadados e conteúdo de skills ativas associadas a um agente.
   * @param agentId ID do agente.
   * @returns Skills ordenadas por prioridade e ordem manual.
   */
  async loadRowsForAgent(agentId: string): Promise<SkillRow[]> {
    const cached = rowsCache.get(agentId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rows
    }

    const rows = await db
      .select({
        id: skills.id,
        slug: skills.slug,
        name: skills.name,
        description: skills.description,
        when_to_use: skills.when_to_use,
        priority: skills.priority,
        content: skills.content,
        order: agentSkills.order
      })
      .from(agentSkills)
      .innerJoin(skills, eq(agentSkills.skill_id, skills.id))
      .where(and(eq(agentSkills.agent_id, agentId), eq(skills.is_active, true)))
      .orderBy(sql`${agentSkills.order}`)

    const sorted = rows.sort((a, b) => rankPriority(a.priority) - rankPriority(b.priority) || (a.order ?? 0) - (b.order ?? 0))
    rowsCache.set(agentId, { rows: sorted, expiresAt: Date.now() + SKILL_CACHE_TTL_MS })
    return sorted
  }

  /**
   * Carrega catálogo resumido de skills para roteamento barato.
   * @param agentId ID do agente.
   * @returns Metadados e resumo cacheável de cada skill.
   */
  async loadSummariesForAgent(agentId: string): Promise<Array<SkillRow & { content_summary: string }>> {
    const rows = await this.loadRowsForAgent(agentId)
    return rows.map((skill) => ({
      ...skill,
      content_summary: summarizeSkillContent(skill.content)
    }))
  }

  /**
   * Carrega skills ativas associadas a um agente.
   * @param agentId ID do agente.
   * @returns Conteúdo concatenado das skills ordenadas por prioridade.
   */
  async loadForAgent(agentId: string): Promise<string> {
    const rows = await this.loadRowsForAgent(agentId)
    return rows
      .map(formatSkill)
      .join('\n\n---\n\n')
  }

  /**
   * Carrega todas as skills ativas, sem filtro por agente.
   * @returns Conteúdo concatenado das skills globais ordenadas por prioridade.
   */
  async loadGlobal(): Promise<string> {
    const rows = await db.select().from(skills).where(eq(skills.is_active, true))

    return rows
      .sort((a, b) => rankPriority(a.priority) - rankPriority(b.priority))
      .map(formatSkill)
      .join('\n\n---\n\n')
  }
}
