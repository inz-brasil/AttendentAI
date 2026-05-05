// token-manager.ts — Criptografa tokens OAuth do Google Calendar e renova access token
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { google } from 'googleapis'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { mcpCredentials } from '../../db/schema'

const ALGORITHM = 'aes-256-gcm'
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

function encryptionKey(): Buffer {
  if (!env.ENCRYPTION_KEY || !/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string')
  }

  return Buffer.from(env.ENCRYPTION_KEY, 'hex')
}

function oauthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  )
}

/**
 * Criptografa um token OAuth com AES-256-GCM.
 * @param token Token em texto puro.
 * @returns Token criptografado no formato iv:tag:dados.
 */
export function encryptToken(token: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Descriptografa um token OAuth salvo no banco.
 * @param encrypted Token criptografado.
 * @returns Token em texto puro.
 */
export function decryptToken(encrypted: string): string {
  const [ivHex, tagHex, dataHex] = encrypted.split(':')
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Invalid encrypted token format')
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') + decipher.final('utf8')
}

/**
 * Retorna access token válido, renovando via refresh_token quando necessário.
 * @param mcpServerId ID do servidor MCP Google Calendar.
 * @returns Access token descriptografado.
 */
export async function getValidAccessToken(mcpServerId: string): Promise<string> {
  const [credential] = await db
    .select()
    .from(mcpCredentials)
    .where(eq(mcpCredentials.mcp_server_id, mcpServerId))
    .limit(1)

  if (!credential?.access_token_encrypted || !credential.refresh_token_encrypted) {
    throw new Error('Google Calendar não conectado')
  }

  const expiry = credential.token_expiry?.getTime() ?? 0
  if (expiry - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    return decryptToken(credential.access_token_encrypted)
  }

  const client = oauthClient()
  client.setCredentials({ refresh_token: decryptToken(credential.refresh_token_encrypted) })
  const { credentials } = await client.refreshAccessToken()
  if (!credentials.access_token) {
    throw new Error('Google não retornou novo access token')
  }

  await db
    .update(mcpCredentials)
    .set({
      access_token_encrypted: encryptToken(credentials.access_token),
      token_expiry: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      updated_at: new Date()
    })
    .where(eq(mcpCredentials.id, credential.id))

  return credentials.access_token
}

/**
 * Cria client OAuth2 configurado com env vars do Google.
 * @returns Instância OAuth2Client.
 */
export function createGoogleOAuthClient() {
  return oauthClient()
}
