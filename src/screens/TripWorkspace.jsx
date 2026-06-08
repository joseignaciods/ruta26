import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTrips } from '../state/TripContext.jsx'

const tabs = [
  ['today','Hoy'], ['route','Ruta'], ['map','Mapa'], ['trip','Viaje'], ['settings','Config']
]

export default function TripWorkspace() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const { trips, activeTrip, setActiveTripId, loading } = useTrips()
  const [tab, setTab] = useState('route')
  const [showDay, setShowDay] = useState(false)
  const [dayForm, setDayForm] = useState({ city:'', title:'', date:'' })
  const { addDay } = useTrips()

  useEffect(() => { setActiveTripId(tripId) }, [tripId, setActiveTripId])
  if (loading) return <div className="center-page">Cargando viaje...</div>
  if (!activeTrip && trips.length) return <Navigate to="/trips" replace />
  if (!activeTrip) return <div className="center-page">Preparando viaje...</div>

  const createDay = async event => {
    event.preventDefault()
    await addDay(dayForm)
    setShowDay(false)
    setDayForm({ city:'', title:'', date:'' })
  }

  return (
    <div className="workspace">
      <header className="workspace-header">
        <button className="back-btn" onClick={() => navigate('/trips')}>←</button>
        <div><span>VIAJE ACTIVO</span><h1>{activeTrip.name}</h1></div>
        <button className="avatar-btn">{activeTrip.name.slice(0,1)}</button>
      </header>

      <main className="workspace-content">
        {tab === 'route' && (
          <section>
            <div className="section-heading"><div><h2>Ruta</h2><p>{activeTrip.days.length} días planificados</p></div><button className="primary-btn compact" onClick={() => setShowDay(true)}>+ Día</button></div>
            {activeTrip.days.length === 0 ? <Empty title="Tu ruta está vacía" text="Agrega el primer día para comenzar a planificar." /> : activeTrip.days.map(day => (
              <article className="day-card" key={day.id}>
                <div className="day-number">{day.day || day.position}</div>
                <div><span>{day.date || 'Sin fecha'} · {day.city}</span><h3>{day.title}</h3><p>{day.activities?.length || 0} panoramas</p></div>
              </article>
            ))}
          </section>
        )}
        {tab === 'today' && <Empty title="Próximo día" text={activeTrip.days.length ? activeTrip.days[0].title : 'Agrega días a la ruta para ver el resumen diario.'} />}
        {tab === 'map' && <Empty title="Mapa del viaje" text="Los panoramas con coordenadas aparecerán aquí al conectar el módulo completo." />}
        {tab === 'trip' && <Empty title="Planificación" text="Hoteles, gastos, equipaje y documentos estarán asociados exclusivamente a este viaje." />}
        {tab === 'settings' && <SettingsPanel trip={activeTrip} />}
      </main>

      <nav className="workspace-nav">
        {tabs.map(([id, label]) => <button key={id} className={tab===id?'active':''} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

      {showDay && (
        <div className="modal-backdrop" onClick={() => setShowDay(false)}>
          <form className="modal-card" onSubmit={createDay} onClick={event => event.stopPropagation()}>
            <h2>Agregar día</h2>
            <label>Ciudad<input required value={dayForm.city} onChange={e => setDayForm({ ...dayForm, city:e.target.value })} /></label>
            <label>Título<input value={dayForm.title} onChange={e => setDayForm({ ...dayForm, title:e.target.value })} /></label>
            <label>Fecha<input type="date" value={dayForm.date} onChange={e => setDayForm({ ...dayForm, date:e.target.value })} /></label>
            <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setShowDay(false)}>Cancelar</button><button className="primary-btn compact">Agregar</button></div>
          </form>
        </div>
      )}
    </div>
  )
}

function Empty({ title, text }) {
  return <div className="empty-panel workspace-empty"><div className="empty-icon">◇</div><h2>{title}</h2><p>{text}</p></div>
}

function SettingsPanel({ trip }) {
  const { updateTrip, invite, revokeInvite } = useTrips()
  const [section, setSection] = useState('general')
  const [form, setForm] = useState({ name:trip.name, startDate:trip.startDate || '', endDate:trip.endDate || '', currency:trip.currency || 'USD', timezone:trip.timezone || 'America/Santiago' })
  const [email, setEmail] = useState('')

  const sendInvite = async event => {
    event.preventDefault()
    await invite(email)
    setEmail('')
  }

  return (
    <section>
      <div className="section-heading"><div><h2>Configuración</h2><p>{trip.name}</p></div></div>
      <div className="subtabs">{['general','members','integrations'].map(id => <button className={section===id?'active':''} key={id} onClick={() => setSection(id)}>{id==='general'?'Viaje':id==='members'?'Participantes':'Integraciones'}</button>)}</div>
      {section === 'general' && <div className="panel-card">
        <label>Nombre<input value={form.name} onChange={e => setForm({ ...form, name:e.target.value })} /></label>
        <div className="two-cols"><label>Inicio<input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate:e.target.value })} /></label><label>Fin<input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate:e.target.value })} /></label></div>
        <button className="primary-btn compact" onClick={() => updateTrip(form)}>Guardar</button>
      </div>}
      {section === 'members' && <div className="panel-card">
        <form className="invite-form" onSubmit={sendInvite}><input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" /><button className="primary-btn compact">Invitar</button></form>
        <h3>Participantes</h3>
        {trip.members.map(member => <div className="member-line" key={member.id}><span>{member.name || member.email || 'Usuario'}</span><b>{member.role === 'owner' ? 'Propietario' : 'Editor'}</b></div>)}
        {trip.invitations?.map(item => <div className="member-line" key={item.id}><span>{item.email}<small>Pendiente</small></span><button onClick={() => revokeInvite(item.id)}>Revocar</button></div>)}
      </div>}
      {section === 'integrations' && <div className="panel-card"><h3>OpenAI</h3><p>La clave se configurará como secreto de la Edge Function. Nunca se guardará en el navegador.</p><div className="status-pill">Pendiente de backend</div></div>}
    </section>
  )
}
