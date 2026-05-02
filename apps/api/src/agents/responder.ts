// responder.ts — Agente respondedor humanizado para WhatsApp
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from '../config/env'
import { BaseAgent, type AgentInput, type AgentRunMetadata } from './base-agent'
import type { ClassificationOutput } from './classifier'

const responderSystemPrompt = `Você é um atendente humanizado de WhatsApp. Responda de forma natural e empática.
NUNCA invente informações que não foram fornecidas. Se não souber algo, diga que vai verificar.
Mantenha respostas curtas (máximo 3 parágrafos). Se a resposta for adequada para áudio (curta,
sem links, sem formatação), inclua [AUDIO_OK] ao final.`

export interface ResponderInput extends AgentInput {
  phone: string
  system_prompt: string
  message: string
  lead_name: string
  memory_summary: string
  vault_context: string
  classification: ClassificationOutput
}

export interface ResponderOutput extends AgentRunMetadata {
  text: string
  audio_requested: boolean
}

export class ResponderAgent extends BaseAgent<ResponderInput, ResponderOutput> {
  constructor() {
    super({
      name: 'responder',
      systemPrompt: responderSystemPrompt,
      model: env.MODEL_RESPONDER || 'gpt-4o-mini',
      maxTokens: env.MAX_TOKENS_RESPONSE,
      temperature: 0.3
    })
  }

  /**
   * Monta mensagens com memória, skills e classificação.
   * @param input Mensagem recebida e contexto isolado.
   * @returns Lista de mensagens para a OpenAI API.
   */
  protected override buildMessages(input: ResponderInput): ChatCompletionMessageParam[] {
    return [
      {
        role: 'system',
        content: input.system_prompt || this.systemPrompt
      },
      {
        role: 'user',
        content: [
          `Nome do lead: ${input.lead_name || 'não informado'}`,
          `Classificação: ${JSON.stringify(input.classification)}`,
          `Memória/contexto complementar: ${input.memory_summary || 'sem memória relevante'}`,
          `Contexto do vault complementar: ${input.vault_context || 'sem contexto relevante'}`,
          `Mensagem recebida: ${input.message}`
        ].join('\n')
      }
    ]
  }

  /**
   * Remove marcador de áudio e devolve saída estruturada.
   * @param text Texto bruto do modelo.
   * @param metadata Métricas da chamada.
   * @returns Resposta pronta para o webhook.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): ResponderOutput {
    const audioRequested = text.includes('[AUDIO_OK]')
    const cleanedText = text.replace('[AUDIO_OK]', '').trim()

    return {
      text: cleanedText,
      audio_requested: audioRequested,
      ...metadata
    }
  }
}
