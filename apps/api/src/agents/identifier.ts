// identifier.ts — Extrai dados explícitos do lead sem inventar campos
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { env } from '../config/env'
import { BaseAgent, type AgentInput, type AgentRunMetadata } from './base-agent'

const identifierSystemPrompt = `Você identifica apenas dados explicitamente declarados na mensagem atual.
Compare com os dados atuais do lead para não repetir extrações.
NUNCA invente campos, cidade, email, nome, status ou tags.
Retorne APENAS JSON válido, sem markdown.

Schema:
{
  "fields_to_update": {
    "name"?: string,
    "email"?: string,
    "city"?: string,
    "status"?: "novo" | "ativo" | "lead_quente" | "convertido" | "inativo",
    "tags"?: string[]
  }
}

Se não houver dado novo explícito, retorne {"fields_to_update":{}}.`

const leadUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  city: z.string().min(1).optional(),
  status: z.enum(['novo', 'ativo', 'lead_quente', 'convertido', 'inativo']).optional(),
  tags: z.array(z.string().min(1)).optional()
})

const identifierOutputSchema = z.object({
  fields_to_update: leadUpdateSchema
})

export type LeadFieldsToUpdate = z.infer<typeof leadUpdateSchema>
export type IdentifierOutput = z.infer<typeof identifierOutputSchema>

export interface IdentifierInput extends AgentInput {
  phone: string
  message: string
  current_lead: {
    name: string | null
    email: string | null
    city: string | null
    status: string | null
    tags: string[] | null
  }
}

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

export class IdentifierAgent extends BaseAgent<IdentifierInput, IdentifierOutput> {
  constructor() {
    super({
      name: 'identifier',
      systemPrompt: identifierSystemPrompt,
      model: env.MODEL_IDENTIFIER || 'gpt-4o-mini',
      maxTokens: 300,
      temperature: 0.1
    })
  }

  /**
   * Monta mensagens com dado atual do lead para evitar duplicidade.
   * @param input Mensagem atual e lead atual.
   * @returns Lista de mensagens para a OpenAI API.
   */
  protected override buildMessages(input: IdentifierInput): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: [
          `Dados atuais do lead: ${JSON.stringify(input.current_lead)}`,
          `Mensagem atual: ${input.message}`
        ].join('\n')
      }
    ]
  }

  /**
   * Valida campos extraídos e retorna objeto vazio se inválido.
   * @param text Texto bruto do modelo.
   * @param metadata Métricas da chamada.
   * @returns Campos do lead a atualizar.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): IdentifierOutput {
    void metadata

    try {
      return identifierOutputSchema.parse(JSON.parse(extractJson(text)))
    } catch {
      return { fields_to_update: {} }
    }
  }
}
