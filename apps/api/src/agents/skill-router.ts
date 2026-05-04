// skill-router.ts — Seleciona skills relevantes para o respondedor antes do prompt final
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { env } from '../config/env'
import { BaseAgent, type AgentInput, type AgentRunMetadata } from './base-agent'
import type { ClassificationOutput } from './classifier'

export interface SkillCandidate {
  id: string
  slug: string | null
  name: string
  description: string | null
  when_to_use: string | null
  priority: string | null
  content: string | null
}

export interface SkillRouterInput extends AgentInput {
  phone: string
  message: string
  history_summary: string
  classification: ClassificationOutput
  candidates: SkillCandidate[]
}

export interface SkillRouterOutput extends AgentRunMetadata {
  selected_skill_ids: string[]
  context_summary: string
  reason: string
}

const skillRouterSystemPrompt = `Você é um roteador de skills para atendimento WhatsApp.
Escolha apenas as skills necessárias para a próxima resposta do agente e sintetize o contexto útil.
Use o resumo da conversa, a última mensagem e a classificação.
Selecione no máximo 3 skills. Se nenhuma skill específica for necessária, selecione atendimento geral se existir.
Leia o conteúdo das skills, mas NÃO copie a skill inteira. Gere um contexto curto e mastigado para o agente respondedor.
Retorne APENAS JSON válido, sem markdown.

Schema:
{
  "selected_skill_ids": ["id-da-skill"],
  "context_summary": "orientações essenciais para responder agora, no máximo 1200 caracteres",
  "reason": "motivo curto"
}`

const skillRouterOutputSchema = z.object({
  selected_skill_ids: z.array(z.string().min(1)).max(3),
  context_summary: z.string().max(1200).default(''),
  reason: z.string().min(1)
})

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

export class SkillRouterAgent extends BaseAgent<SkillRouterInput, SkillRouterOutput> {
  constructor() {
    super({
      name: 'skill-router',
      systemPrompt: skillRouterSystemPrompt,
      model: env.MODEL_CLASSIFIER || 'gpt-4o-mini',
      maxTokens: 350,
      temperature: 0.1
    })
  }

  /**
   * Monta o contexto de decisão com resumo, mensagem e catálogo de skills.
   * @param input Dados da conversa e skills candidatas.
   * @returns Mensagens para o modelo.
   */
  protected override buildMessages(input: SkillRouterInput): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: [
          `Classificação: ${JSON.stringify(input.classification)}`,
          `Resumo da conversa:\n${input.history_summary || 'sem resumo'}`,
          `Última mensagem recebida:\n${input.message}`,
          `Skills candidatas com conteúdo para leitura e síntese:\n${JSON.stringify(input.candidates)}`
        ].join('\n\n')
      }
    ]
  }

  /**
   * Valida a seleção de skills e remove IDs inexistentes.
   * @param text Resposta bruta do modelo.
   * @param metadata Métricas da chamada.
   * @returns Skills selecionadas.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): SkillRouterOutput {
    try {
      const parsed = skillRouterOutputSchema.parse(JSON.parse(extractJson(text)))
      return {
        selected_skill_ids: parsed.selected_skill_ids,
        context_summary: parsed.context_summary,
        reason: parsed.reason,
        ...metadata
      }
    } catch {
      return {
        selected_skill_ids: [],
        context_summary: '',
        reason: 'fallback_json_invalido',
        ...metadata
      }
    }
  }
}
