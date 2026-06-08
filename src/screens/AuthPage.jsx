import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'

export default function AuthPage({ initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode)
  const [form, setForm] = useState({ name:'', email:'', password:'' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { login, register, backend } = useAuth()

  const submit = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await login(form)
      else await register(form)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">R26</div>
        <h1>Ruta 26</h1>
        <p>Planifica viajes en compañía.</p>
        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>Nombre<input required value={form.name} onChange={e => setForm({ ...form, name:e.target.value })} /></label>
          )}
          <label>Correo<input required type="email" value={form.email} onChange={e => setForm({ ...form, email:e.target.value })} /></label>
          <label>Contraseña<input required minLength="6" type="password" value={form.password} onChange={e => setForm({ ...form, password:e.target.value })} /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-btn" disabled={busy}>{busy ? 'Procesando...' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</button>
        </form>
        <button className="link-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Crear una cuenta' : 'Ya tengo una cuenta'}
        </button>
        {backend === 'local' && <div className="dev-badge">Modo local de desarrollo</div>}
        <Link className="hidden-link" to="/trips">Continuar</Link>
      </section>
    </main>
  )
}
