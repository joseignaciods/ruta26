import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((message, type = 'error') => {
    const id = crypto.randomUUID()
    setToasts(list => [...list, { id, message, type }])
    setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map(item => <div key={item.id} className={`toast ${item.type}`}>{item.message}</div>)}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
