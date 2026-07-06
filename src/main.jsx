import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './state/AuthContext.jsx'
import { TripProvider } from './state/TripContext.jsx'
import { ToastProvider } from './state/ToastContext.jsx'
import './styles.css'

// Tras un deploy, un chunk lazy cacheado (PlacePicker, generador, mapa) puede
// quedar 404 porque su hash cambió; el import dinámico falla y la vista "se
// rompe" al abrirla. Vite dispara 'vite:preloadError' → recargamos para tomar
// la versión nueva. La guarda evita bucles si la recarga no resuelve (chunk
// realmente ausente); se re-arma a los 5s de una carga estable.
window.addEventListener('vite:preloadError', event => {
  event.preventDefault?.()
  if (sessionStorage.getItem('ruta26_reloading_chunk')) return
  sessionStorage.setItem('ruta26_reloading_chunk', '1')
  window.location.reload()
})
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem('ruta26_reloading_chunk'), 5000)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <TripProvider>
            <App />
          </TripProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
)
