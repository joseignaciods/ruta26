import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((message, options = 'error') => {
    const id = crypto.randomUUID()
    const config = typeof options === 'string' ? { type:options } : options
    setToasts(list => [...list, { id, message, type:config.type || 'error', action:config.action }])
    setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), config.duration || 5000)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map(item => <div key={item.id} className={`toast ${item.type}`}><span>{item.message}</span>{item.action && <button onClick={() => { item.action.onClick(); setToasts(list => list.filter(toast => toast.id !== item.id)) }}>{item.action.label}</button>}</div>)}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
