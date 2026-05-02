'use client'
// confirm-dialog.tsx — Modal de confirmação para ações destrutivas (Radix Dialog)
import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  children?: ReactNode
}

/**
 * Dialog de confirmação reutilizável para ações destrutivas.
 * @param props Controle de abertura, textos e callback de confirmação.
 * @returns Modal Radix com overlay.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  onConfirm
}: ConfirmDialogProps): JSX.Element {
  const confirmClass =
    variant === 'danger'
      ? 'bg-danger text-white hover:bg-danger/80'
      : 'bg-accent text-canvas hover:bg-[#e7ef58]'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-canvas/80 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-panel border border-line p-6 shadow-2xl animate-in fade-in zoom-in-95"
          aria-describedby="confirm-desc"
        >
          {/* Ícone de alerta */}
          <div className="flex items-start gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger/15 border border-danger/30">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-danger" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              <Dialog.Description id="confirm-desc" className="mt-2 text-sm leading-6 text-muted">
                {description}
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <button className="focus-ring h-9 rounded-md border border-line bg-elevated px-4 text-sm text-ink transition hover:bg-panel">
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              onClick={() => { onConfirm(); onOpenChange(false) }}
              className={`focus-ring h-9 rounded-md px-4 text-sm font-semibold transition ${confirmClass}`}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
