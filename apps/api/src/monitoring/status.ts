// status.ts — Mantém métricas leves de runtime para health detalhado
let lastMessageProcessed: string | null = null

/** Marca o timestamp da última mensagem processada com sucesso. */
export function markMessageProcessed(): void {
  lastMessageProcessed = new Date().toISOString()
}

/** Retorna o timestamp da última mensagem processada com sucesso. */
export function getLastMessageProcessed(): string | null {
  return lastMessageProcessed
}
