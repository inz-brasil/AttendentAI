// whatsapp-formatting.ts — Regras e normalização de texto para mensagens WhatsApp

export const WHATSAPP_FORMATTING_RULES = `FORMATAÇÃO OBRIGATÓRIA PARA WHATSAPP:
1. Use somente formatação nativa do WhatsApp:
   - *Título ou destaque curto* com UM asterisco de cada lado
   - > Subtítulo, observação ou bloco em destaque
   - ~texto~ para algo negativo, removido, cancelado ou indisponível
   - - item para listas simples
2. Nunca use Markdown de documento:
   - Proibido **texto**
   - Proibido ##, ###, tabelas markdown e blocos longos robotizados
3. Para separar blocos, use uma linha em branco real entre eles.
4. Não escreva "/n"; use quebra de linha real.
5. Evite ponto final quando a frase já termina naturalmente numa quebra de linha.
6. Evite listas numeradas em mensagens que serão enviadas pelo WhatsApp; prefira "- item".
7. Se precisar listar perguntas, use cada pergunta completa em uma linha, sem "1." isolado.
8. Seja natural, curto e humano. Relatórios podem ser estruturados, mas devem caber bem no WhatsApp.`

/**
 * Normaliza marcações que quebram a renderização esperada no WhatsApp.
 * @param text Texto bruto retornado pelo agente.
 * @returns Texto compatível com WhatsApp.
 */
export function normalizeWhatsAppFormatting(text: string): string {
  return text
    .replace(/—/g, '-')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\\n/g, '\n')
    .replace(/\/n\//gi, '\n\n')
    .replace(/\/n/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
