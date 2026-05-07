'use client'
// toast-provider.tsx — Provider de notificações toast (Radix Toast)
import * as Toast from '@radix-ui/react-toast'
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ToastMessage {
  id: string
  title: string
  description?: string
  variant: 'success' | 'danger' | 'default'
}

interface ToastContextValue {
  toast: (msg: Omit<ToastMessage, 'id'>) => void
}

const ToastCtx = createContext<ToastContextValue>({ toast: () => undefined })

/** Hook para disparar toasts de qualquer componente. */
export function useToast(): ToastContextValue {
  return useContext(ToastCtx)
}

/**
 * Provider global de toasts. Deve envolver o layout raiz.
 * @param props children.
 * @returns Provider + viewport de toasts.
 */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [messages, setMessages] = useState<ToastMessage[]>([])

  /** Remove um toast específico imediatamente. */
  const dismiss = useCallback((id: string) => {
    setMessages((prev) => prev.filter((message) => message.id !== id))
  }, [])

  const toast = useCallback((msg: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setMessages((prev) => [...prev, { ...msg, id }])
    // Remove após 5s
    setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), 5000)
  }, [])

  const variantBorder: Record<string, string> = {
    success: 'border-success/40 bg-success/10',
    danger: 'border-danger/40 bg-danger/10',
    default: 'border-line bg-panel'
  }

  const variantDot: Record<string, string> = {
    success: 'bg-success',
    danger: 'bg-danger',
    default: 'bg-muted'
  }

  return (
    <ToastCtx.Provider value={{ toast }}>
      <Toast.Provider swipeDirection="right" duration={4500}>
        {children}
        {messages.map((msg) => (
          <Toast.Root
            key={msg.id}
            open={true}
            onOpenChange={(open) => {
              if (!open) dismiss(msg.id)
            }}
            className={`flex items-start gap-3 rounded-xl border p-3 shadow-2xl ${variantBorder[msg.variant]}`}
          >
            <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${variantDot[msg.variant]}`} />
            <div className="flex-1 min-w-0">
              <Toast.Title className="text-sm font-semibold text-ink">{msg.title}</Toast.Title>
              {msg.description && (
                <Toast.Description className="mt-1 text-xs text-muted">{msg.description}</Toast.Description>
              )}
            </div>
            <Toast.Close
              className="focus-ring ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-elevated hover:text-ink"
              onClick={() => dismiss(msg.id)}
              aria-label="Fechar notificação"
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" />
      </Toast.Provider>
    </ToastCtx.Provider>
  )
}
