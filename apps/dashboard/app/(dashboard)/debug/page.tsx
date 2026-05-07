// page.tsx — Página de debug em tempo real
import { DebugClient } from './debug-client'

/**
 * Renderiza o console de debug.
 * @returns Página de observabilidade.
 */
export default function DebugPage(): JSX.Element {
  return <DebugClient />
}
