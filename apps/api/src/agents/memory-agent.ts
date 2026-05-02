// memory-agent.ts — Lê contexto do vault e gera notas persistentes de conversa
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from '../config/env'
import { VaultManager } from '../vault-manager/manager'
import { BaseAgent, type AgentInput, type AgentRunMetadata } from './base-agent'

const memorySystemPrompt = `Você resume uma conversa de atendimento para uma nota operacional curta.
Registre apenas fatos explícitos da conversa.
Não invente dados, interesses, prazos ou próximos passos.
Retorne apenas texto Markdown curto, sem frontmatter.`

export interface MemoryNoteInput extends AgentInput {
  phone: string
  conversation: string
}

export interface MemoryNoteOutput extends AgentRunMetadata {
  note: string
}

export interface LeadMemoryData {
  phone: string
  name: string | null
  email: string | null
  city: string | null
  status: string | null
  tags: string[] | null
}

function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function readCreatedAt(existingMemory: string): string {
  const match = existingMemory.match(/^created_at:\s*"([^"]+)"/m)
  return match?.[1] ?? new Date().toISOString()
}

export class MemoryAgent extends BaseAgent<MemoryNoteInput, MemoryNoteOutput> {
  private readonly vault: VaultManager

  constructor(vault = new VaultManager(env.VAULT_PATH)) {
    super({
      name: 'memory-agent',
      systemPrompt: memorySystemPrompt,
      model: env.MODEL_MEMORY || 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0.2
    })
    this.vault = vault
  }

  /**
   * Busca trecho relevante do vault usando intent como filtro simples.
   * @param phone Telefone do lead.
   * @param intent Intenção classificada.
   * @returns Contexto textual do vault.
   */
  async fetchRelevant(phone: string, intent: string): Promise<string> {
    const [memory, history, notes] = await Promise.all([
      this.vault.read(phone, 'memoria.md'),
      this.vault.read(phone, 'historico.md'),
      this.vault.read(phone, 'notas.md')
    ])

    if (intent === 'sales' || intent === 'qualification') {
      return [memory, notes].filter(Boolean).join('\n\n')
    }

    if (intent === 'support' || intent === 'complaint') {
      return [history, notes].filter(Boolean).join('\n\n')
    }

    return [memory, history, notes].filter(Boolean).join('\n\n')
  }

  /**
   * Gera nota da conversa e faz append assíncrono no vault.
   * @param phone Telefone do lead.
   * @param conversation Conversa completa relevante.
   * @returns Nada.
   */
  async saveNote(phone: string, conversation: string): Promise<void> {
    const output = await this.run({ phone, conversation })
    if (output.note.trim().length > 0) {
      await this.vault.append(phone, 'notas.md', output.note.trim())
    }
  }

  /**
   * Atualiza memoria.md com dados confirmados do lead.
   * @param phone Telefone do lead.
   * @param lead Dados atuais do lead.
   * @returns Nada.
   */
  async updateLeadMemory(phone: string, lead: LeadMemoryData): Promise<void> {
    const existingMemory = await this.vault.read(phone, 'memoria.md')
    const createdAt = readCreatedAt(existingMemory)
    const now = new Date().toISOString()
    const name = lead.name ?? 'não informado'
    const status = lead.status ?? 'novo'
    const tags = lead.tags ?? []

    const content = `---
phone: ${quoteYaml(phone)}
name: ${quoteYaml(name)}
created_at: ${quoteYaml(createdAt)}
updated_at: ${quoteYaml(now)}
status: ${quoteYaml(status)}
tags: ${JSON.stringify(tags)}
---

## Dados do Contato
- **Telefone:** ${phone}
- **Nome:** ${name}
- **Cidade:** ${lead.city ?? '(não informado)'}
- **Email:** ${lead.email ?? '(não informado)'}

## Perfil
- **Interesse principal:** ${tags.includes('premium') ? 'Plano Premium' : '(não informado)'}
- **Dor relatada:** (não informado)
- **Objeção principal:** (não informado)
- **Decisor:** (não informado)

## Estágio
- **Status atual:** ${status}
- **Próximo passo:** (não definido)
- **Data do próximo contato:** (não definida)
`

    await this.vault.write(phone, 'memoria.md', content)
  }

  /**
   * Monta prompt para sintetizar nota persistente.
   * @param input Conversa a resumir.
   * @returns Lista de mensagens para a OpenAI API.
   */
  protected override buildMessages(input: MemoryNoteInput): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: input.conversation }
    ]
  }

  /**
   * Converte texto bruto em nota.
   * @param text Texto do modelo.
   * @param metadata Métricas da chamada.
   * @returns Nota de memória.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): MemoryNoteOutput {
    return {
      note: text.trim(),
      ...metadata
    }
  }
}
