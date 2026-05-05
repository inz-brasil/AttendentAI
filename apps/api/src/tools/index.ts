// index.ts — Registry de tools disponíveis para agentes LLM
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { executeHttpRequestTool } from './http-request'
import { executeLeadLookupTool, executePlatformStatsTool, executeVaultReadTool } from './platform'

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

  throw new Error(`Unknown tool: ${name}`)
}
