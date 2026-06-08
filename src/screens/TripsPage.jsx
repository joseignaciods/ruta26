import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext.jsx'
import { useTrips } from '../state/TripContext.jsx'

export default function TripsPage() {
  const { user, logout, backend } = useAuth()
  const { trips, createTrip, setActiveTripId, loading } = useTrips()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name:'', startDate:'', endDate:'', currency:'USD' })
  const navigate = useNavigate()

  const openTrip = trip => {
    setActiveTripId(trip.id)
    navigate(`/trips/${trip.id}`)
  }

  const submit = async event => {
    event.preventDefault()
    const trip = await createTrip(form)
    navigate(`/trips/${trip.id}`)
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div><span className="eyebrow">RUTA 26</span><h1>Mis viajes</h1><p>Hola, {user.user_metadata?.name || user.name || user.email}</p></div>
        <button className="ghost-btn" onClick={logout}>Salir</button>
      </header>

      {backend === 'local' && <div className="notice">Ambiente local: los datos están en este navegador. Al conectar Supabase se sincronizarán entre usuarios.</div>}

      {loading ? <div className="empty-panel">Cargando viajes...</div> : trips.length === 0 ? (
        <section className="empty-panel">
          <div className="empty-icon">✈</div>
          <h2>Aún no tienes viajes</h2>
          <p>Producción comienza vacía. Crea tu primer viaje o acepta una invitación.</p>
          <button className="primary-btn compact" onClick={() => setShowCreate(true)}>Crear primer viaje</button>
        </section>
      ) : (
        <section className="trip-grid">
          {trips.map(trip => (
            <button key={trip.id} className="trip-card" onClick={() => openTrip(trip)}>
              <div className="trip-cover">{trip.name.slice(0,2).toUpperCase()}</div>
              <div><h2>{trip.name}</h2><p>{trip.startDate || 'Sin fecha'} · {trip.members.length} participante(s)</p></div>
              <span>→</span>
            </button>
          ))}
          <button className="new-trip-card" onClick={() => setShowCreate(true)}>+ Nuevo viaje</button>
        </section>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form className="modal-card" onSubmit={submit} onClick={event => event.stopPropagation()}>
            <h2>Crear viaje</h2>
            <label>Nombre<input autoFocus required value={form.name} onChange={e => setForm({ ...form, name:e.target.value })} placeholder="Ej. Japón 2027" /></label>
            <div className="two-cols">
              <label>Inicio<input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate:e.target.value })} /></label>
              <label>Fin<input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate:e.target.value })} /></label>
            </div>
            <label>Moneda<select value={form.currency} onChange={e => setForm({ ...form, currency:e.target.value })}><option>USD</option><option>CLP</option><option>EUR</option></select></label>
            <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setShowCreate(false)}>Cancelar</button><button className="primary-btn compact">Crear vacío</button></div>
          </form>
        </div>
      )}
    </main>
  )
}
