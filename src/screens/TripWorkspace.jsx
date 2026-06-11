import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTrips } from '../state/TripContext.jsx'
import { hasSupabase } from '../lib/supabase.js'
import RouteTab from '../components/RouteTab.jsx'
import AssistantChat from '../components/AssistantChat.jsx'
import TripTab from '../components/TripTab.jsx'
import TodayTab from '../components/TodayTab.jsx'

const MapTab = lazy(() => import('../components/MapTab.jsx'))

const tabs = [
  ['today','Hoy','sun'],
  ['route','Ruta','route'],
  ['map','Mapa','map'],
  ['trip','Viaje','suitcase'],
  ['settings','Config','settings']
]

function NavIcon({ name }) {
  const paths = {
    sun:<><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    route:<><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M7.5 16.5c1.8-1.8 1.8-4.2 0-6s-1.8-4.2 0-6M16.5 7.5c-1.8 1.8-1.8 4.2 0 6s1.8 4.2 0 6" /></>,
    map:<><path d="m3 6 5-2 8 2 5-2v14l-5 2-8-2-5 2Z" /><path d="M8 4v14M16 6v14" /></>,
    suitcase:<><rect x="4" y="7" width="16" height="12" rx="2" /><path d="M9 7V5c0-1 .8-2 2-2h2c1.2 0 2 1 2 2v2M8 12v2M16 12v2" /></>,
    settings:<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6A8 8 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 10.4 18l.3 2.6h4L15 18a8 8 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" /></>
  }
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

export default function TripWorkspace() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const { trips, activeTrip, setActiveTripId, loading } = useTrips()
  const [tab, setTab] = useState('route')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantPrompt, setAssistantPrompt] = useState('')
  const initializedTrip = useRef(null)

  const openAssistant = prompt => {
    if (typeof prompt === 'string' && prompt) setAssistantPrompt(prompt)
    setAssistantOpen(true)
  }

  useEffect(() => { setActiveTripId(tripId) }, [tripId, setActiveTripId])
  useEffect(() => {
    if (activeTrip?.id === tripId && initializedTrip.current !== tripId) {
      initializedTrip.current = tripId
      setTab(activeTrip.days.some(day => day.date) ? 'today' : 'route')
    }
  }, [activeTrip, tripId])
  if (loading && !activeTrip) return <div className="center-page">Cargando viaje...</div>
  if (!activeTrip && trips.length) return <Navigate to="/trips" replace />
  if (!activeTrip) return <div className="center-page">Preparando viaje...</div>

  return (
    <div className="workspace">
      <header className="workspace-header">
        <button className="back-btn" onClick={() => navigate('/trips')}>←</button>
        <div><span>VIAJE ACTIVO</span><h1>{activeTrip.name}</h1></div>
        <button className="avatar-btn">{activeTrip.name.slice(0,1)}</button>
      </header>

      <main className="workspace-content">
        {tab === 'route' && <RouteTab onAskAssistant={openAssistant} />}
        {tab === 'today' && <TodayTab onOpenAssistant={openAssistant} />}
        {tab === 'map' && <Suspense fallback={<div className="center-page">Cargando mapa...</div>}><MapTab /></Suspense>}
        {tab === 'trip' && <TripTab />}
        {tab === 'settings' && <SettingsPanel trip={activeTrip} />}
      </main>

      <AssistantChat
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        initialPrompt={assistantPrompt}
        onPromptConsumed={() => setAssistantPrompt('')}
      />

      <nav className="workspace-nav">
        {tabs.map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <NavIcon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function SettingsPanel({ trip }) {
  const { updateTrip, invite, revokeInvite } = useTrips()
  const [section, setSection] = useState('general')
  const [form, setForm] = useState({ name:trip.name, startDate:trip.startDate || '', endDate:trip.endDate || '', currency:trip.currency || 'USD', timezone:trip.timezone || 'America/Santiago', notes:trip.preferences?.notes || '' })
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
        <label>Notas para el asistente<textarea rows={3} placeholder="Ej. viajamos con un niño de 8 años, sin carne, presupuesto medio" value={form.notes} onChange={e => setForm({ ...form, notes:e.target.value })} /></label>
        <button className="primary-btn compact" onClick={() => updateTrip({ ...form, preferences:{ ...trip.preferences, notes:form.notes } })}>Guardar</button>
      </div>}
      {section === 'members' && <div className="panel-card">
        <form className="invite-form" onSubmit={sendInvite}><input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" /><button className="primary-btn compact">Invitar</button></form>
        <h3>Participantes</h3>
        {trip.members.map(member => <div className="member-line" key={member.id}><span>{member.name || member.email || 'Usuario'}</span><b>{member.role === 'owner' ? 'Propietario' : 'Editor'}</b></div>)}
        {trip.invitations?.map(item => <div className="member-line" key={item.id}><span>{item.email}<small>Pendiente</small></span><button onClick={() => revokeInvite(item.id)}>Revocar</button></div>)}
      </div>}
      {section === 'integrations' && <div className="panel-card">
        <h3>Asistente IA</h3>
        {hasSupabase
          ? <><p>Conectado vía Edge Functions <code>trip-assistant</code> y <code>travel-search</code>. El asistente puede editar el viaje y consultar lugares reales en Tripadvisor cuando su secreto está configurado.</p><div className="status-pill">Backend conectado</div></>
          : <><p>Modo local: el asistente responde con resúmenes básicos del viaje. Conecta Supabase y configura <code>OPENAI_API_KEY</code> para habilitar la IA completa.</p><div className="status-pill">Modo local</div></>}
      </div>}
    </section>
  )
}
