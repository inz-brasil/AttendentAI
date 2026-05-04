// memory.ts — Fonte única de verdade para parâmetros da memória contínua
export const MEMORY_CONFIG = {
  SLIDING_WINDOW_SIZE: 10,
  COMPACTION_THRESHOLD: 20,
  MESSAGES_PRESERVED_AFTER_COMPACTION: 10,
  MAX_MEMORY_TOKENS: 1500,
  MIN_COMPACTION_INTERVAL_MS: 60_000
} as const
