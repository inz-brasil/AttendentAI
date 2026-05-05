// classifier.ts — Classifica mensagem com contexto mínimo e saída JSON validada
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { env } from '../config/env'
import { BaseAgent, type AgentInput, type AgentRunMetadata } from './base-agent'

const classifierSystemPrompt = `Você é um classificador de mensagens de atendimento.
Você NÃO recebe dados do lead e NÃO deve inferir dados pessoais.
Retorne APENAS JSON válido, sem markdown, sem comentários e sem texto fora do JSON.
Use o resumo histórico para manter continuidade do assunto.
Se o resumo histórico indicar conversa sobre reunião, agenda, horário, disponibilidade, online ou presencial, e a mensagem atual for confirmação curta como "sim", "pode confirmar", "online", "fechado" ou "ok", classifique como "scheduling".

Schema obrigatório:
{
  "intent": "greeting" | "sales" | "support" | "scheduling" | "qualification" | "complaint" | "other",
  "sentiment": "positive" | "neutral" | "negative",
  "urgency": "low" | "medium" | "high",
  "is_new_topic": boolean,
  "needs_human": boolean,
  "language": "pt-BR" | "en" | "es" | "other"
}`

export const classificationSchema = z.object({
  intent: z.enum(['greeting', 'sales', 'support', 'scheduling', 'qualification', 'complaint', 'other']),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  urgency: z.enum(['low', 'medium', 'high']),
  is_new_topic: z.boolean(),
  needs_human: z.boolean(),
  language: z.enum(['pt-BR', 'en', 'es', 'other'])
})

export type ClassificationOutput = z.infer<typeof classificationSchema>

export interface ClassifierInput extends AgentInput {
  phone: string
  message: string
  history_summary: string
}

const defaultClassification: ClassificationOutput = {
  intent: 'other',
  sentiment: 'neutral',
  urgency: 'low',
  is_new_topic: true,
  needs_human: false,
  language: 'pt-BR'
}

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

export class ClassifierAgent extends BaseAgent<ClassifierInput, ClassificationOutput> {
  constructor() {
    super({
      name: 'classifier',
      systemPrompt: classifierSystemPrompt,
      model: env.MODEL_CLASSIFIER || 'gpt-4o-mini',
      maxTokens: 200,
      temperature: 0.1
    })
  }

  /**
   * Monta mensagens sem dados pessoais do lead.
   * @param input Mensagem atual e resumo histórico.
   * @returns Lista de mensagens para a OpenAI API.
   */
  protected override buildMessages(input: ClassifierInput): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: [`Mensagem: ${input.message}`, `Resumo histórico: ${input.history_summary || 'sem histórico'}`].join('\n')
      }
    ]
  }

  /**
   * Valida JSON do classificador e cai para defaults se inválido.
   * @param text Texto bruto do modelo.
   * @param metadata Métricas da chamada.
   * @returns Classificação validada.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): ClassificationOutput {
    void metadata

    try {
      return classificationSchema.parse(JSON.parse(extractJson(text)))
    } catch {
      return defaultClassification
    }
  }
}
