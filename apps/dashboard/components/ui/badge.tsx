// badge.tsx — Componente de badge para status, tags e labels
import type { ReactNode } from 'react'

type BadgeVariant = 'default' | 'accent' | 'success' | 'danger' | 'cyan' | 'muted'

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantClass: Record<BadgeVariant, string> = {
  default: 'bg-elevated text-ink border border-line',
  accent: 'bg-accent/15 text-accent border border-accent/30',
  success: 'bg-success/15 text-success border border-success/30',
  danger: 'bg-danger/15 text-danger border border-danger/30',
  cyan: 'bg-cyan/15 text-cyan border border-cyan/30',
  muted: 'bg-canvas text-muted border border-line'
}

/**
 * Badge visual para status, tags e classificações.
 * @param props Conteúdo e variante visual.
 * @returns Badge renderizado.
 */
export function Badge({ children, variant = 'default', className = '' }: BadgeProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${variantClass[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
