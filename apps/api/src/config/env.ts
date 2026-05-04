// env.ts — Valida e centraliza todas as variáveis de ambiente da API
import { z } from 'zod'

const booleanStringSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY é obrigatória'),
  OPENAI_BASE_URL: z.string().url('OPENAI_BASE_URL deve ser uma URL válida'),
  WEBHOOK_SECRET: z.string().min(1, 'WEBHOOK_SECRET é obrigatória'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  SQLITE_JOURNAL_MODE: z.enum(['WAL', 'DELETE']).default('WAL'),
  REDIS_URL: z.string().url('REDIS_URL deve ser uma URL válida'),
  MODEL_ORCHESTRATOR: z.string().min(1),
  MODEL_CLASSIFIER: z.string().min(1),
  MODEL_IDENTIFIER: z.string().min(1),
  MODEL_RESPONDER: z.string().min(1).default('gpt-4o-mini'),
  MODEL_SUMMARIZER: z.string().min(1),
  MODEL_MEMORY: z.string().min(1),
  MAX_TOKENS_RESPONSE: z.coerce.number().int().positive(),
  MAX_TOKENS_CONTEXT: z.coerce.number().int().positive(),
  MAX_MESSAGES_IN_CONTEXT: z.coerce.number().int().positive(),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive(),
  MAX_CONCURRENT_CHATS: z.coerce.number().int().positive(),
  LOCK_TTL_SECONDS: z.coerce.number().int().positive(),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1000),
  WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  VAULT_PATH: z.string().min(1).default('./vault'),
  DASHBOARD_PORT: z.coerce.number().int().positive(),
  API_PORT: z.coerce.number().int().positive(),
  DASHBOARD_SECRET: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.string().url('NEXT_PUBLIC_API_URL deve ser uma URL válida'),
  AUDIO_AUTO_ENABLED: booleanStringSchema,
  AUDIO_MAX_CHARS: z.coerce.number().int().positive(),
  ENCRYPTION_KEY: z.string().optional(),
  MCP_ENABLED: booleanStringSchema.default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional()
})

function readRawEnv(): Record<keyof z.input<typeof envSchema>, string | undefined> {
  return {
    OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: Bun.env.OPENAI_BASE_URL,
    WEBHOOK_SECRET: Bun.env.WEBHOOK_SECRET,
    DATABASE_URL: Bun.env.DATABASE_URL,
    SQLITE_JOURNAL_MODE: Bun.env.SQLITE_JOURNAL_MODE,
    REDIS_URL: Bun.env.REDIS_URL,
    MODEL_ORCHESTRATOR: Bun.env.MODEL_ORCHESTRATOR,
    MODEL_CLASSIFIER: Bun.env.MODEL_CLASSIFIER,
    MODEL_IDENTIFIER: Bun.env.MODEL_IDENTIFIER,
    MODEL_RESPONDER: Bun.env.MODEL_RESPONDER,
    MODEL_SUMMARIZER: Bun.env.MODEL_SUMMARIZER,
    MODEL_MEMORY: Bun.env.MODEL_MEMORY,
    MAX_TOKENS_RESPONSE: Bun.env.MAX_TOKENS_RESPONSE,
    MAX_TOKENS_CONTEXT: Bun.env.MAX_TOKENS_CONTEXT,
    MAX_MESSAGES_IN_CONTEXT: Bun.env.MAX_MESSAGES_IN_CONTEXT,
    WEBHOOK_TIMEOUT_MS: Bun.env.WEBHOOK_TIMEOUT_MS,
    MAX_CONCURRENT_CHATS: Bun.env.MAX_CONCURRENT_CHATS,
    LOCK_TTL_SECONDS: Bun.env.LOCK_TTL_SECONDS,
    API_RATE_LIMIT_PER_MINUTE: Bun.env.API_RATE_LIMIT_PER_MINUTE,
    WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE: Bun.env.WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE,
    VAULT_PATH: Bun.env.VAULT_PATH,
    DASHBOARD_PORT: Bun.env.DASHBOARD_PORT,
    API_PORT: Bun.env.API_PORT,
    DASHBOARD_SECRET: Bun.env.DASHBOARD_SECRET,
    NEXT_PUBLIC_API_URL: Bun.env.NEXT_PUBLIC_API_URL,
    AUDIO_AUTO_ENABLED: Bun.env.AUDIO_AUTO_ENABLED,
    AUDIO_MAX_CHARS: Bun.env.AUDIO_MAX_CHARS,
    ENCRYPTION_KEY: Bun.env.ENCRYPTION_KEY,
    MCP_ENABLED: Bun.env.MCP_ENABLED,
    GOOGLE_CLIENT_ID: Bun.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: Bun.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: Bun.env.GOOGLE_REDIRECT_URI,
    ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY
  }
}

export const env = envSchema.parse(readRawEnv())
