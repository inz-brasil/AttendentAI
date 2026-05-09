// message-splitter.ts — Quebra resposta em segmentos com delay humanizado
export interface SplitMessage {
  text: string
  delay_ms: number
}

// Respostas curtas não precisam de divisão
const SINGLE_MESSAGE_THRESHOLD = 100

// Limite de mensagens por resposta para não sobrecarregar o lead
const MAX_SEGMENTS = 4

// Limite de chars para considerar uma sentença "curta" (acknowledgment isolado)
const SHORT_SENTENCE_THRESHOLD = 40

// Padrão: quebra de sentença antes de letra maiúscula
const SENTENCE_BOUNDARY_RE = /([.!?])\s+(?=[A-ZÁÉÍÓÚÀÃÂÊÎÔÛÇ\u{1F300}-\u{1FAFF}])/u

/**
 * Calcula delay realista para simular digitação humana.
 * @param text Texto do segmento.
 * @param index Posição do segmento (0 = primeiro).
 * @returns Delay em ms.
 */
function calculateDelay(text: string, index: number): number {
  const chars = text.trim().length

  let base: number
  if (chars <= 30) base = 600
  else if (chars <= 80) base = 1200
  else if (chars <= 180) base = 2000
  else base = 2800

  // Cada segmento seguinte tem um pequeno delay adicional (pessoa ainda "está digitando")
  const sequenceBonus = index * 180

  // Jitter ±25% do base para variação natural
  const jitter = Math.floor((Math.random() - 0.5) * base * 0.5)

  return Math.max(400, Math.min(5000, base + sequenceBonus + jitter))
}

/**
 * Divide texto em sentenças usando limite de pontuação.
 * @param text Texto a dividir.
 * @returns Array de sentenças.
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  let remaining = text.trim()

  while (remaining.length > 0) {
    const match = SENTENCE_BOUNDARY_RE.exec(remaining)
    if (!match) {
      sentences.push(remaining)
      break
    }

    const cut = match.index + 1
    const sentence = remaining.slice(0, cut).trim()
    if (sentence) sentences.push(sentence)
    remaining = remaining.slice(cut).trimStart()
  }

  return sentences.filter(Boolean)
}

/**
 * Agrupa sentenças em segmentos de mensagem (máx MAX_SEGMENTS).
 * Se a primeira sentença for um acknowledgment curto (≤ 40 chars), isola ela.
 * @param sentences Lista de sentenças.
 * @returns Lista de segmentos agrupados.
 */
function groupSentences(sentences: string[]): string[] {
  if (sentences.length === 0) return []
  if (sentences.length === 1) return sentences

  const groups: string[] = []
  const first = (sentences[0] ?? '').trim()

  if (first.length <= SHORT_SENTENCE_THRESHOLD && sentences.length > 1) {
    // Acknowledgment curto isolado: "Entendi.", "Anotado!", "Certo."
    groups.push(first)
    const rest = sentences.slice(1)

    if (rest.length <= 2) {
      groups.push(rest.join(' ').trim())
    } else {
      const mid = Math.ceil(rest.length / 2)
      groups.push(rest.slice(0, mid).join(' ').trim())
      groups.push(rest.slice(mid).join(' ').trim())
    }
  } else {
    // Sem acknowledgment curto: divide ao meio nas sentenças
    const mid = Math.ceil(sentences.length / 2)
    groups.push(sentences.slice(0, mid).join(' ').trim())
    groups.push(sentences.slice(mid).join(' ').trim())
  }

  return groups.filter(Boolean).slice(0, MAX_SEGMENTS)
}

/**
 * Divide resposta do bot em múltiplos segmentos com delays humanizados.
 * Respostas curtas (≤ 100 chars) são enviadas como mensagem única.
 * @param text Texto completo da resposta.
 * @returns Array de segmentos com delay em ms.
 */
export function splitMessage(text: string): SplitMessage[] {
  const trimmed = text.trim()

  if (!trimmed) {
    return []
  }

  // Texto curto: mensagem única sem divisão
  if (trimmed.length <= SINGLE_MESSAGE_THRESHOLD) {
    return [{ text: trimmed, delay_ms: calculateDelay(trimmed, 0) }]
  }

  // Divisão por quebras de parágrafo (dois ou mais newlines)
  const paragraphs = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length >= 2) {
    return paragraphs.slice(0, MAX_SEGMENTS).map((p, i) => ({
      text: p,
      delay_ms: calculateDelay(p, i)
    }))
  }

  // Divisão por sentenças dentro de parágrafo único
  const sentences = splitIntoSentences(trimmed)
  if (sentences.length <= 1) {
    return [{ text: trimmed, delay_ms: calculateDelay(trimmed, 0) }]
  }

  const groups = groupSentences(sentences)
  return groups.map((g, i) => ({
    text: g,
    delay_ms: calculateDelay(g, i)
  }))
}
