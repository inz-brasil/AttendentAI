// loader.ts — Carrega skills ativas do banco para injeção em prompts
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { agentSkills, skills } from '../db/schema'

type Priority = 'high' | 'medium' | 'low'

const priorityRank: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2
}

function rankPriority(priority: string | null): number {
  return priorityRank[(priority ?? 'medium') as Priority] ?? priorityRank.medium
}

function formatSkill(skill: {
  name: string
  description: string | null
  when_to_use: string | null
  priority: string | null
  content: string | null
}): string {
  return [
    `## Skill: ${skill.name}`,
    skill.description ? `Descrição: ${skill.description}` : null,
    skill.when_to_use ? `Quando usar: ${skill.when_to_use}` : null,
    `Prioridade: ${skill.priority ?? 'medium'}`,
    skill.content
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n')
}

export class SkillsLoader {
  /**
   * Carrega metadados e conteúdo de skills ativas associadas a um agente.
   * @param agentId ID do agente.
   * @returns Skills ordenadas por prioridade e ordem manual.
   */
  async loadRowsForAgent(agentId: string): Promise<Array<{
    name: string
    description: string | null
    when_to_use: string | null
    priority: string | null
    content: string | null
    order: number | null
  }>> {
    const rows = await db
      .select({
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

    return rows.sort((a, b) => rankPriority(a.priority) - rankPriority(b.priority) || (a.order ?? 0) - (b.order ?? 0))
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
