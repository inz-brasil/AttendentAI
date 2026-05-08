// seed.ts — Insere agentes e skills padrão de forma idempotente
import { eq } from 'drizzle-orm'
import { db, closeDb } from './client'
import { agentSkills, agents, settings, skills } from './schema'

const now = new Date()

async function readSkillTemplate(filename: string): Promise<string> {
  return Bun.file(new URL(`../skills/templates/${filename}`, import.meta.url)).text()
}

const defaultAgents = [
  {
    id: 'classifier',
    name: 'Classifier',
    description: 'Classifica intenção, sentimento e tipo de mensagem recebida.',
    type: 'classifier' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 500,
    system_prompt:
      'Classifique a mensagem do lead em JSON estruturado. Não invente dados ausentes e use apenas o texto recebido.'
  },
  {
    id: 'identifier',
    name: 'Identifier',
    description: 'Extrai dados explícitos do lead e identifica atualizações de perfil.',
    type: 'identifier' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 700,
    system_prompt:
      'Extraia somente informações declaradas pelo lead. Retorne JSON validável e ignore inferências sem evidência.'
  },
  {
    id: 'responder',
    name: 'Responder',
    description: 'Gera a resposta final humanizada com base no contexto confirmado.',
    type: 'responder' as const,
    model: 'gpt-4o',
    temperature: 0.7,
    max_tokens: 800,
    system_prompt: `Você é o atendente consultivo da {company_name}. Humano, direto e natural — fala como uma pessoa de verdade fala no WhatsApp, não como um script de call center.

Seu objetivo é qualificar o lead progressivamente e, quando houver fit e abertura, marcar uma reunião com o time comercial.

<anti_bias>
Frases completamente banidas — se escrever qualquer uma, apague e recomece:
- "Olá! Seja bem-vindo(a)!"
- "Estou aqui para ajudar"
- "Como posso te ajudar hoje?"
- "Qualquer dúvida, é só perguntar"
- "Ficou alguma dúvida?"
- "Tenha um ótimo dia!"
- "Claro! Com prazer!"
A regra: se um atendente de call center falaria assim, você não fala.
</anti_bias>

<exemplos_contrastivos>
ERRADO: "Olá! Seja bem-vindo! Como posso te ajudar hoje?"
CERTO: "Oi! Me conta o que você precisa"

ERRADO: "Entendido! Vou verificar essa informação para você agora mesmo. Aguarde!"
CERTO: "Deixa eu verificar aqui"

ERRADO: "Que ótimo! Posso te ajudar com mais alguma coisa?"
CERTO: "Que bom! 😄"

ERRADO: "Perfeito! Qualquer dúvida, é só entrar em contato!"
CERTO: "Anotado! Qualquer coisa me chama"
</exemplos_contrastivos>

<funil_qualificacao>
Conduza a conversa progressivamente. Apenas UMA pergunta por mensagem. Adapte ao ritmo do lead — não pressione.

ETAPA 1 — Abertura
Quando: lead entrou em contato e você não sabe o nome
Ação: apresente-se brevemente e pergunte nome + empresa
Exemplo: "Oi! Sou do time da {company_name}. Com quem estou falando?"

ETAPA 2 — Diagnóstico
Quando: já tem nome e empresa
Ação: entenda a função/cargo e a dor principal
Exemplo: "Qual é o maior desafio de marketing que vocês enfrentam hoje?"

ETAPA 3 — Contexto
Quando: já sabe a dor
Ação: avalie maturidade (já investe em tráfego? tem time interno? já trabalhou com agência?)
Pergunte apenas UM aspecto por vez

ETAPA 4 — Proposta de Valor
Quando: tem contexto suficiente para conectar o problema à solução
Ação: mostre como resolve aquela dor específica usando dados do vault
Não liste serviços — fale do problema que você resolve

ETAPA 5 — Objeções
Quando: lead resistir ou questionar
Ação: valide a objeção antes de responder, use dados concretos do vault
Nunca defenda — entenda primeiro

ETAPA 6 — Agendamento
Quando: houver abertura ou interesse claro
Ação: proponha uma conversa rápida (30 min) com o time
Colete: nome dos participantes, email de contato, confirme telefone (padrão: número atual)
Só confirme reunião quando houver event_id do agente de agendamento
</funil_qualificacao>

<formatacao>
- Sem ponto final no fim de linhas que já terminam naturalmente
- Quebra linha entre blocos diferentes — não manda tudo junto
- Resposta simples → uma ou duas linhas
- Máximo 3 blocos por mensagem — mais que isso, quebre em partes
- Nunca use markdown de documento, bullets com asterisco ou headers com #
</formatacao>

<regras_conteudo>
- Nunca invente preços, resultados ou disponibilidades — use apenas o que está no vault ou diga "vou verificar"
- Confirme reunião só com event_id confirmado pelo agente de agendamento
- [Reação: X]: não precisa responder
- [Figurinha]: resposta curta e natural (ex: "kkk 😂")
- [Áudio]: responda ao conteúdo descrito normalmente
</regras_conteudo>`
  },
  {
    id: 'memory-agent',
    name: 'Memory Agent',
    description: 'Lê, resume e registra memória persistente do lead.',
    type: 'memory' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 800,
    system_prompt:
      'Organize a memória do lead com fatos verificáveis, histórico resumido e próximos passos. Não registre suposições.'
  },
  {
    id: 'internal-assistant',
    name: 'Assistente Interno',
    description: 'Atende operadores autorizados e opera a plataforma com tools internas.',
    type: 'internal' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 900,
    system_prompt:
      'Você é o assistente interno do AttendentAI. Consulte dados reais com tools, ajude a resumir leads, gerar relatórios e enviar dados para webhooks quando solicitado.'
  }
]

const defaultSkillDefinitions = [
  {
    id: 'atendimento-geral',
    name: 'Atendimento Geral',
    slug: 'atendimento-geral',
    description: 'Fluxo base para atendimento inicial e dúvidas gerais.',
    category: 'atendimento',
    when_to_use: 'Use quando a intenção não se encaixar em uma skill mais específica.',
    priority: 'medium' as const,
    template: 'atendimento-geral.md'
  },
  {
    id: 'vendas',
    name: 'Vendas',
    slug: 'vendas',
    description: 'Condução de conversas com intenção comercial.',
    category: 'vendas',
    when_to_use: 'Use quando o lead demonstrar interesse em contratar, comprar ou comparar planos.',
    priority: 'high' as const,
    template: 'vendas.md'
  },
  {
    id: 'suporte',
    name: 'Suporte',
    slug: 'suporte',
    description: 'Atendimento para dúvidas técnicas, problemas e solicitações de ajuda.',
    category: 'suporte',
    when_to_use: 'Use quando o lead relatar erro, bloqueio, problema ou dúvida operacional.',
    priority: 'high' as const,
    template: 'suporte.md'
  },
  {
    id: 'qualificacao',
    name: 'Qualificação',
    slug: 'qualificacao',
    description: 'Perguntas para entender perfil, necessidade e estágio do lead.',
    category: 'vendas',
    when_to_use: 'Use quando faltarem dados para identificar fit, urgência ou decisor.',
    priority: 'medium' as const,
    template: 'qualificacao.md'
  },
  {
    id: 'agendamento',
    name: 'Agendamento',
    slug: 'agendamento',
    description: 'Fluxo para marcar reuniões, demonstrações ou próximos contatos.',
    category: 'atendimento',
    when_to_use: 'Use quando o lead pedir reunião, demonstração, ligação ou retorno em data específica.',
    priority: 'high' as const,
    template: 'agendamento.md'
  },
  {
    id: 'reativacao',
    name: 'Reativação',
    slug: 'reativacao',
    description: 'Retomada de conversa com leads inativos.',
    category: 'vendas',
    when_to_use: 'Use quando o lead voltar após longo intervalo ou quando houver tentativa ativa de retomada.',
    priority: 'low' as const,
    template: 'reativacao.md'
  }
]

const defaultSettings = [
  {
    key: 'agent_name',
    value: 'AtendenteAI',
    description: 'Nome exibido/usado pelo atendente principal'
  },
  {
    key: 'company_name',
    value: 'AttendentAI',
    description: 'Nome da empresa atendida pelo agente'
  },
  {
    key: 'agent_tone',
    value: 'humanizado, claro, breve e consultivo',
    description: 'Tom padrão das respostas do agente'
  },
  {
    key: 'internal_assistant_contacts',
    value: '',
    description: 'Telefones ou JIDs autorizados para o assistente interno, separados por vírgula ou linha'
  },
  {
    key: 'tool_http_enabled',
    value: 'false',
    description: 'Habilita a tool http_request para o agente respondedor'
  },
  {
    key: 'automation_enabled',
    value: 'true',
    description: 'Liga/desliga respostas automáticas do agente principal'
  },
  {
    key: 'automation_schedule_enabled',
    value: 'false',
    description: 'Quando true, o bot só responde dentro da janela configurada'
  },
  {
    key: 'automation_schedule_start',
    value: '18:00',
    description: 'Início da janela em que o bot pode responder automaticamente'
  },
  {
    key: 'automation_schedule_end',
    value: '09:00',
    description: 'Fim da janela em que o bot pode responder automaticamente'
  },
  {
    key: 'automation_schedule_timezone',
    value: 'America/Sao_Paulo',
    description: 'Timezone usado para janela de atendimento automático'
  },
  {
    key: 'automation_blacklist_default_minutes',
    value: '120',
    description: 'Duração padrão da pausa automática quando humano assume'
  },
  {
    key: 'wacli_enabled',
    value: 'false',
    description: 'Habilita tool wacli para assistente interno'
  },
  {
    key: 'wacli_command',
    value: '/usr/local/bin/wacli',
    description: 'Binário/comando wacli disponível no container da API'
  },
  {
    key: 'wacli_store',
    value: '/data/wacli',
    description: 'Diretório opcional do store wacli; vazio usa padrão do wacli'
  }
]

/**
 * Insere registros padrão sem duplicar dados já existentes.
 * @returns Nada.
 */
async function seed(): Promise<void> {
  const defaultSkills = await Promise.all(
    defaultSkillDefinitions.map(async (skill) => ({
      ...skill,
      content: await readSkillTemplate(skill.template)
    }))
  )

  await db
    .insert(agents)
    .values(defaultAgents.map((agent) => ({ ...agent, updated_at: now })))
    .onConflictDoNothing()

  await db
    .insert(settings)
    .values(defaultSettings.map((setting) => ({ ...setting, updated_at: now })))
    .onConflictDoNothing()

  await db
    .insert(skills)
    .values(defaultSkills.map(({ template, ...skill }) => ({ ...skill, updated_at: now })))
    .onConflictDoNothing()

  const existingResponderSkills = await db.select().from(agentSkills).where(eq(agentSkills.agent_id, 'responder'))
  if (existingResponderSkills.length === 0) {
    await db.insert(agentSkills).values(
      defaultSkills.map((skill, index) => ({
        agent_id: 'responder',
        skill_id: skill.id,
        order: index
      }))
    )
  }
}

try {
  await seed()
  closeDb()
} catch (error) {
  closeDb()
  throw error
}
