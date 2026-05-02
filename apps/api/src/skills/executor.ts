// executor.ts — Formata uma skill individual para injeção no prompt
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { skills } from '../db/schema'

export interface SkillExecutionContext {
  phone?: string
  intent?: string
  leadName?: string
}

export class SkillsExecutor {
  /**
   * Carrega e formata uma skill específica.
   * @param skillId ID da skill.
   * @param context Contexto opcional de execução.
   * @returns Conteúdo formatado para prompt.
   */
  async executeSkill(skillId: string, context: SkillExecutionContext = {}): Promise<string> {
    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
    if (!skill || !skill.is_active) {
      return ''
    }

    return [
      `## Skill: ${skill.name}`,
      skill.description ? `Descrição: ${skill.description}` : null,
      skill.when_to_use ? `Quando usar: ${skill.when_to_use}` : null,
      `Contexto: ${JSON.stringify(context)}`,
      skill.content
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n')
  }
}
