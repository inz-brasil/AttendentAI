// index.ts — Registry de tools disponíveis para agentes LLM
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { executeHttpRequestTool } from './http-request'
import { executeLeadLookupTool, executePlatformStatsTool } from './platform'

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
    description: 'Consulta métricas operacionais do AttendentAI, como leads totais e mensagens por período.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  }
}

export const leadLookupToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'lead_lookup',
    description: 'Busca leads pelo telefone ou nome para responder perguntas internas do operador.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Nome ou telefone do lead.'
        },
        limit: {
          type: 'number',
          description: 'Quantidade máxima de leads retornados.'
        }
      },
      required: ['query']
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

  throw new Error(`Unknown tool: ${name}`)
}
