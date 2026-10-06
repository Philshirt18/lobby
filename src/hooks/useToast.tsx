import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Toast = { id: number; text: string; error: boolean }
type Ctx = { toast: (text: string, error?: boolean) => void }

const ToastContext = createContext<Ctx>({ toast: () => {} })
export const useToast = () => useContext(ToastContext)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const toast = useCallback((text: string, error = false) => {
    const id = nextId++
    setItems((xs) => [...xs, { id, text, error }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), error ? 7000 : 3500)
  }, [])
  const value = useMemo(() => ({ toast }), [toast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div id="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={'toast' + (t.error ? ' err' : '')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
