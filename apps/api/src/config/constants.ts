// constants.ts — Centraliza feature flags e constantes globais da API
import { env } from './env'

export const MCP_ENABLED = env.MCP_ENABLED
export const API_RATE_LIMIT_PER_MINUTE = env.API_RATE_LIMIT_PER_MINUTE
export const WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE = env.WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE
