// paragraph-splitter.ts — Separa blocos de WhatsApp apenas por linha em branco explícita

/**
 * Divide texto em blocos de envio preservando listas e relatórios.
 * @param text Texto retornado pelo agente.
 * @returns Blocos não vazios para envio individual.
 */
export function splitWhatsAppParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\/n\//g, '\n\n')
    .replace(/\/n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}
