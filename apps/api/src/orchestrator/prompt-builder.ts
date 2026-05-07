// prompt-builder.ts — Monta system prompt em camadas para o agente respondedor
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { MCP_ENABLED } from '../config/constants'
import { env } from '../config/env'
import { WHATSAPP_FORMATTING_RULES } from '../config/whatsapp-formatting'
import { db } from '../db/client'
import { agents, settings } from '../db/schema'
import { SkillsLoader } from '../skills/loader'
import type { MemorySnapshot } from '../memory/persistent'
import { VaultManager } from '../vault-manager/manager'

export interface LeadPromptContext {
  phone: string
  name: string | null
  city: string | null
  status: string | null
  tags: string[] | null
  currentTime: string
  timezone: string
}

export interface PromptBuilderInput {
  responderId: string
  lead: LeadPromptContext
  memory: MemorySnapshot
  vaultContext: string
  skillContext: string
  selectedSkillIds?: string[]
}

export interface PromptBuildResult {
  prompt: string
  skills: Array<{
    name: string
    priority: string | null
    order: number | null
    when_to_use: string | null
  }>
  globalFiles: string[]
  promptChars: number
}

const log = pino({ name: 'attendentai-prompt-builder' })

const antiHallucinationRules = `REGRAS INVIOLÁVEIS:
1. Se você não tem certeza de uma informação, NÃO a invente
2. Se não encontrou a informação nos dados fornecidos, use: "Vou verificar isso para você"
3. Nunca invente preços, prazos, funcionalidades ou políticas
4. Responda apenas com base no contexto fornecido
5. Em caso de dúvida, prefira pedir mais informações ao usuário`

export class PromptBuilder {
  private readonly skillsLoader = new SkillsLoader()
  private readonly vault = new VaultManager(env.VAULT_PATH)

  /**
   * Monta o system prompt do respondedor em cinco camadas.
   * @param input Contexto necessário para montar o prompt.
   * @returns System prompt final.
   */
  async build(input: PromptBuilderInput): Promise<string> {
    const result = await this.buildDetailed(input)
    return result.prompt
  }

  /**
   * Monta o system prompt e devolve metadados para debug do pipeline.
   * @param input Contexto necessário para montar o prompt.
   * @returns Prompt final e metadados de skills/vault.
   */
  async buildDetailed(input: PromptBuilderInput): Promise<PromptBuildResult> {
    const [agentName, companyName, agentTone, httpToolEnabled, configuredPrompt, skillsContext, globalContext] = await Promise.all([
      this.getSetting('agent_name', 'AtendenteAI'),
      this.getSetting('company_name', 'AttendentAI'),
      this.getSetting('agent_tone', 'humanizado, claro, breve e consultivo'),
      this.getSetting('tool_http_enabled', 'false'),
      this.getAgentSystemPrompt(input.responderId),
      this.loadSkillsContext(input.responderId, input.selectedSkillIds),
      this.loadGlobalVaultContext()
    ])

    const basePrompt = this.replacePromptVariables(configuredPrompt, input, agentName, companyName, agentTone)
    const prompt = [
      this.buildIdentityLayer({ basePrompt, agentName, companyName, agentTone, globalContext: globalContext.content }),
      this.buildSkillsLayer(input.skillContext),
      this.buildLeadDataLayer(input),
      this.buildMcpToolsLayer(),
      this.buildOutputLayer(httpToolEnabled)
    ].join('\n\n---\n\n')

    log.info({ system_prompt: prompt }, 'system prompt built')
    return {
      prompt,
      skills: skillsContext.skills,
      globalFiles: globalContext.files,
      promptChars: prompt.length
    }
  }

  private async getSetting(key: string, fallback: string): Promise<string> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
    return setting?.value ?? fallback
  }

  private async getAgentSystemPrompt(agentId: string): Promise<string> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
    return agent?.system_prompt ?? ''
  }

  private replacePromptVariables(
    prompt: string,
    input: PromptBuilderInput,
    agentName: string,
    companyName: string,
    agentTone: string
  ): string {
    return prompt
      .replace(/{agent_name}/g, agentName)
      .replace(/{company_name}/g, companyName)
      .replace(/{agent_tone}/g, agentTone)
      .replace(/{lead_name}/g, input.lead.name ?? 'não informado')
      .replace(/{lead_phone}/g, input.lead.phone)
      .replace(/{current_date}/g, input.lead.currentTime)
      .replace(/{current_time}/g, input.lead.currentTime)
      .replace(/{history_summary}/g, 'ver CAMADA 3 — DADOS DO LEAD ATUAL')
      .replace(/{vault_context}/g, 'ver CAMADA 3 — DADOS DO LEAD ATUAL')
  }

  private extractInterest(leadSummary: string, vaultContext: string): string {
    const source = `${leadSummary}\n${vaultContext}`.toLowerCase()
    if (source.includes('premium')) {
      return 'plano premium'
    }

    return 'não informado'
  }

  /**
   * Camada 1: identidade estática do atendente, prompt configurado e contexto global cacheável.
   * @param input Dados estáticos do agente e da empresa.
   * @returns Texto da camada de identidade.
   */
  private buildIdentityLayer(input: {
    basePrompt: string
    agentName: string
    companyName: string
    agentTone: string
    globalContext: string
  }): string {
    const fallbackPrompt = `Nome do atendente: ${input.agentName}
Empresa: ${input.companyName}
Tom e estilo: ${input.agentTone}`

    return `CAMADA 1 — IDENTIDADE DO ATENDENTE
${input.basePrompt || fallbackPrompt}

Contexto operacional:
Nome do atendente: ${input.agentName}
Empresa: ${input.companyName}
Tom e estilo: ${input.agentTone}

Contexto global aprovado:
${this.truncateBlock(input.globalContext || 'sem contexto global cadastrado', 3500)}

${antiHallucinationRules}`
  }

  /**
   * Camada 2: skills ativas e cacheáveis para o agente respondedor.
   * @param skillsContent Conteúdo das skills vinculadas ao agente.
   * @returns Texto da camada de skills.
   */
  private buildSkillsLayer(skillsContent: string): string {
    return `CAMADA 2 — SKILLS ATIVAS
${skillsContent || 'Nenhuma skill ativa vinculada ao respondedor.'}`
  }

  /**
   * Camada 3: dados do lead atual, resumo histórico e notas relevantes do vault.
   * @param input Contexto dinâmico do lead e memória carregada.
   * @returns Texto da camada de dados do lead.
   */
  private buildLeadDataLayer(input: PromptBuilderInput): string {
    return `CAMADA 3 — DADOS DO LEAD ATUAL
Telefone: ${input.lead.phone}
Data/hora atual (${input.lead.timezone}): ${input.lead.currentTime}
Nome: ${input.lead.name ?? 'não informado'}
Cidade: ${input.lead.city ?? 'não informada'}
Interesse: ${this.extractInterest(input.memory.lead_summary, input.vaultContext)}
Estágio: ${input.lead.status ?? 'não informado'}
Tags: ${input.lead.tags?.join(', ') || 'sem tags'}

Resumo histórico:
${this.truncateBlock(input.memory.history_summary || 'sem histórico sumarizado', 2500)}

Notas relevantes:
${this.truncateBlock(input.memory.notes_summary || 'sem notas relevantes', 1800)}

Contexto relevante do vault:
${this.truncateBlock(input.vaultContext || 'sem contexto relevante', 3500)}`
  }

  /**
   * Camada 4: ferramentas MCP disponíveis para o agente; vazia quando a feature flag está desligada.
   * @returns Texto da camada de tools MCP ou string vazia.
   */
  private buildMcpToolsLayer(): string {
    if (!MCP_ENABLED) {
      return ''
    }

    return `CAMADA 4 — FERRAMENTAS MCP DISPONÍVEIS
Nenhuma ferramenta MCP registrada para este agente no momento.`
  }

  /**
   * Camada 5: instruções finais de saída e limites de formato da resposta.
   * @param httpToolEnabled Flag legada de tool HTTP hardcoded.
   * @returns Texto da camada de saída.
   */
  private buildOutputLayer(httpToolEnabled: string): string {
    return `CAMADA 5 — INSTRUÇÃO DE SAÍDA
Responda APENAS com o texto da mensagem final.
${WHATSAPP_FORMATTING_RULES}
Siga a formatação, ordem de atendimento e restrições definidas no prompt configurado do agente.
Não use markdown de documento, bullets com asterisco ou headers com #.
${httpToolEnabled === 'true' ? 'Use a tool http_request quando houver webhook/API e dados confirmados para executar uma ação externa.' : 'Tools externas estão desativadas para este agente no momento.'}
Faça no máximo UMA pergunta direta na resposta final.
Se houver duas perguntas possíveis, escolha a mais importante para avançar a conversa agora.
Se for curto e adequado para áudio, inclua [AUDIO_OK] ao final
Máximo 3 parágrafos`
  }

  private async loadSkillsContext(agentId: string, selectedSkillIds: string[] | undefined): Promise<{
    skills: PromptBuildResult['skills']
  }> {
    const allRows = await this.skillsLoader.loadRowsForAgent(agentId)
    const selectedSet = new Set(selectedSkillIds ?? [])
    const rows = selectedSkillIds
      ? allRows.filter((skill) => selectedSet.has(skill.id))
      : allRows
    return {
      skills: rows.map((skill) => ({
        name: skill.name,
        priority: skill.priority,
        order: skill.order,
        when_to_use: skill.when_to_use
      }))
    }
  }

  private async loadGlobalVaultContext(): Promise<{ content: string; files: string[] }> {
    const files = await this.vault.listGlobalFiles()
    const contents = await Promise.all(
      files.map(async (file) => {
        const content = await this.vault.readGlobal(file)
        return content.trim() ? `# ${file}\n${content.trim()}` : ''
      })
    )
    return {
      content: contents.filter(Boolean).join('\n\n'),
      files
    }
  }

  private truncateBlock(value: string, maxLength: number): string {
    const normalized = value.replace(/\n{3,}/g, '\n\n').trim()
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
  }
}
