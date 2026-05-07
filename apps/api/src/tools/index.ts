// index.ts — Registry de tools disponíveis para agentes LLM
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { executeHttpRequestTool } from './http-request'
import { executePlatformEditorTool } from './platform-editor'
import { executeLeadLookupTool, executePlatformStatsTool, executeVaultReadTool } from './platform'
import { executeSystemControlTool } from './system-control'
import { executeWacliTool } from './wacli'

export const httpRequestToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'http_request',
    description:
      'Envia uma requisição HTTP para webhooks ou APIs externas quando for necessário registrar/agendar/enviar dados fora do chat. Use POST com JSON por padrão.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'URL http(s) completa do webhook ou API.'
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          description: 'Método HTTP. Use POST para webhooks n8n.'
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Headers extras, como Authorization, quando forem fornecidos pelo operador.'
        },
        body: {
          type: 'object',
          description: 'JSON com os dados confirmados na conversa.'
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout da requisição em milissegundos.'
        }
      },
      required: ['url']
    }
  }
}

export const platformStatsToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'platform_stats',
    description:
      'Consulta métricas reais do AttendentAI. Use para responder quantos atendimentos houve hoje, nas últimas 24h, 7 dias ou 30 dias.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'last_24_hours', 'last_7_days', 'last_30_days'],
          description: 'Período da consulta. Para "hoje", use today.'
        }
      }
    }
  }
}

export const leadLookupToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'lead_lookup',
    description: 'Busca ou lista leads pelo telefone/nome para responder perguntas internas do operador.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Nome ou telefone do lead. Se omitido, lista os leads mais recentes.'
        },
        limit: {
          type: 'number',
          description: 'Quantidade máxima de leads retornados.'
        },
        include_vault: {
          type: 'boolean',
          description: 'Inclui preview de memoria.md e notas.md do vault do lead.'
        }
      }
    }
  }
}

export const vaultReadToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'vault_read',
    description: 'Lê memoria.md, historico.md ou notas.md de um lead específico no vault.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        phone: {
          type: 'string',
          description: 'Telefone/WhatsApp exato do lead.'
        },
        filename: {
          type: 'string',
          enum: ['memoria.md', 'historico.md', 'notas.md'],
          description: 'Arquivo do vault a ler.'
        },
        max_chars: {
          type: 'number',
          description: 'Limite de caracteres retornados.'
        }
      },
      required: ['phone']
    }
  }
}

export const systemControlToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'system_control',
    description:
      'Controla o sistema AttendentAI: liga/desliga respostas automáticas, configura horário de atendimento automático e gerencia blacklist.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'enable_agent', 'disable_agent', 'set_schedule', 'add_blacklist', 'remove_blacklist']
        },
        phone: { type: 'string', description: 'Telefone para ações de blacklist.' },
        reason: { type: 'string', description: 'Motivo auditável da ação.' },
        schedule_enabled: { type: 'boolean', description: 'Ativa/desativa janela de resposta automática.' },
        schedule_start: { type: 'string', description: 'Horário HH:mm em que o bot começa a responder.' },
        schedule_end: { type: 'string', description: 'Horário HH:mm em que o bot para de responder.' },
        timezone: { type: 'string', description: 'Timezone, ex: America/Sao_Paulo.' },
        blacklist_default_minutes: { type: 'number', description: 'Duração padrão da pausa por atendimento humano.' }
      },
      required: ['action']
    }
  }
}

export const wacliToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'wacli',
    description:
      'Usa o wacli para consultar histórico sincronizado, fazer backfill ou enviar mensagem WhatsApp quando o admin pedir explicitamente.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['doctor', 'search_messages', 'send_text', 'backfill', 'list_groups', 'group_info']
        },
        query: { type: 'string', description: 'Texto a buscar em mensagens sincronizadas.' },
        phone: { type: 'string', description: 'Telefone de destino ou lead individual.' },
        chat_jid: { type: 'string', description: 'JID WhatsApp completo. Grupos usam sufixo @g.us.' },
        message: { type: 'string', description: 'Mensagem a enviar via wacli send text para phone ou chat_jid.' },
        limit: { type: 'number', description: 'Limite de resultados de busca.' },
        requests: { type: 'number', description: 'Quantidade de requisições de backfill.' },
        count: { type: 'number', description: 'Quantidade de mensagens por requisição de backfill.' }
      },
      required: ['action']
    }
  }
}

export const platformEditorToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'platform_editor',
    description:
      'Melhora a própria plataforma de forma auditada: lista/lê agentes e skills, atualiza system prompts, skills e arquivos do vault quando o admin pedir explicitamente.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: [
            'list_agents',
            'read_agent',
            'update_agent_prompt',
            'list_skills',
            'read_skill',
            'update_skill',
            'write_vault',
            'append_vault',
            'write_global_vault',
            'append_global_vault'
          ]
        },
        apply: {
          type: 'boolean',
          description: 'false simula; true salva. Use true só quando o admin pedir para aplicar/salvar/corrigir.'
        },
        rationale: {
          type: 'string',
          description: 'Motivo auditável da alteração. Obrigatório para ações de escrita.'
        },
        agent_id: { type: 'string', description: 'ID do agente alvo.' },
        skill_id: { type: 'string', description: 'ID da skill alvo.' },
        phone: { type: 'string', description: 'Telefone do lead para editar vault do lead.' },
        filename: {
          type: 'string',
          description: 'Arquivo do vault. Para lead: memoria.md, historico.md ou notas.md. Para global: nome .md seguro.'
        },
        system_prompt: { type: 'string', description: 'Novo system prompt completo do agente.' },
        content: { type: 'string', description: 'Novo conteúdo ou trecho a anexar.' },
        description: { type: 'string', description: 'Nova descrição da skill.' },
        when_to_use: { type: 'string', description: 'Nova regra de quando usar a skill.' },
        max_chars: { type: 'number', description: 'Limite de caracteres para leitura.' }
      },
      required: ['action']
    }
  }
}

/**
 * Executa uma tool pelo nome registrado.
 * @param name Nome da função chamada pelo modelo.
 * @param args Argumentos JSON parseados.
 * @returns Resultado serializável para devolver ao modelo.
 */
export async function executeRegisteredTool(name: string, args: unknown): Promise<unknown> {
  if (name === 'http_request') {
    return executeHttpRequestTool(args)
  }

  if (name === 'platform_stats') {
    return executePlatformStatsTool(args)
  }

  if (name === 'lead_lookup') {
    return executeLeadLookupTool(args)
  }

  if (name === 'vault_read') {
    return executeVaultReadTool(args)
  }

  if (name === 'system_control') {
    return executeSystemControlTool(args)
  }

  if (name === 'wacli') {
    return executeWacliTool(args)
  }

  if (name === 'platform_editor') {
    return executePlatformEditorTool(args)
  }

  throw new Error(`Unknown tool: ${name}`)
}
