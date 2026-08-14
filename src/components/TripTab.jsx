import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/AuthContext.jsx'
import { useTrips } from '../state/TripContext.jsx'
import { formatDate } from '../lib/planner.js'
import { settleUp } from '../lib/settle.js'
import { searchCities, searchOsmPois } from '../lib/geo.js'
import { computeBalances, resolveSplit } from '../lib/computeBalances.js'
import SplitEditor from './SplitEditor.jsx'

const money = (amount, currency) => `${Number(amount || 0).toLocaleString('es-CL', { maximumFractionDigits:2 })} ${currency}`
const memberName = (userId, members) => { const member = members.find(item => item.userId === userId); return member?.name || member?.email || 'Miembro' }

export default function TripTab({ onOpenAssistant }) {
  const [section, setSection] = useState('hotels')
  const { activeTrip } = useTrips()

  return (
    <section>
      <div className="section-heading"><div><h2>Viaje</h2><p>Reservas, gastos, cartera y equipaje</p></div></div>
      <div className="subtabs">
        <button className={section === 'hotels' ? 'active' : ''} onClick={() => setSection('hotels')}>Hoteles</button>
        <button className={section === 'expenses' ? 'active' : ''} onClick={() => setSection('expenses')}>Gastos</button>
        <button className={section === 'wallet' ? 'active' : ''} onClick={() => setSection('wallet')}>Cartera</button>
        <button className={section === 'packing' ? 'active' : ''} onClick={() => setSection('packing')}>Equipaje</button>
      </div>
      {section === 'hotels' && <Hotels trip={activeTrip} />}
      {section === 'expenses' && <Expenses trip={activeTrip} />}
      {section === 'wallet' && <Wallet trip={activeTrip} />}
      {section === 'packing' && <Packing trip={activeTrip} onOpenAssistant={onOpenAssistant} />}
    </section>
  )
}

function Hotels({ trip }) {
  const { user } = useAuth()
  const { addHotel, deleteHotel, searchPlaces } = useTrips()
  const members = trip.members.filter(member => member.status === 'active')
  const emptyHotel = { name:'', city:'', address:'', checkIn:'', checkOut:'', latitude:null, longitude:null, cost:'', costCurrency:trip.currency || 'USD', url:'', register:false, paidBy:user.id, split:{} }
  const [form, setForm] = useState(emptyHotel)
  const [splitOpen, setSplitOpen] = useState(false)
  const [cityResults, setCityResults] = useState([])
  const [hotelResults, setHotelResults] = useState([])
  const [cityBusy, setCityBusy] = useState(false)
  const [hotelBusy, setHotelBusy] = useState(false)
  const cityTimer = useRef(null)
  const hotelTimer = useRef(null)
  const hotelBlurTimer = useRef(null)
  // Coords de la ciudad elegida en el dropdown: sesgan la búsqueda OSM de hoteles.
  const cityAnchor = useRef(null)

  useEffect(() => () => {
    clearTimeout(cityTimer.current)
    clearTimeout(hotelTimer.current)
    clearTimeout(hotelBlurTimer.current)
  }, [])

  const submit = async event => {
    event.preventDefault()
    const activeIds = members.map(member => member.userId)
    const cost = Number(form.cost) || null
    const expense = form.register && cost ? { paidBy:form.paidBy, split:resolveSplit(form.split, cost, activeIds) } : null
    const result = await addHotel({ ...form, cost, expense })
    if (result !== null) {
      setForm(emptyHotel)
      setCityResults([])
      setHotelResults([])
    }
  }

  const changeCity = value => {
    setForm(current => ({ ...current, city:value, name:'', address:'', latitude:null, longitude:null }))
    cityAnchor.current = null
    setHotelResults([])
    clearTimeout(cityTimer.current)
    if (value.trim().length < 2) { setCityResults([]); return }
    cityTimer.current = setTimeout(async () => {
      setCityBusy(true)
      try { setCityResults(await searchCities(value)) } catch { setCityResults([]) }
      setCityBusy(false)
    }, 350)
  }

  const chooseCity = city => {
    setForm(current => ({ ...current, city:city.name, name:'', address:'', latitude:null, longitude:null }))
    cityAnchor.current = (city.latitude != null && city.longitude != null) ? { latitude:city.latitude, longitude:city.longitude } : null
    setCityResults([])
  }

  const changeHotel = value => {
    setForm(current => ({ ...current, name:value, address:'', latitude:null, longitude:null }))
    clearTimeout(hotelTimer.current)
    if (form.city.trim().length < 2 || value.trim().length < 2) { setHotelResults([]); return }
    hotelTimer.current = setTimeout(async () => {
      setHotelBusy(true)
      // TripAdvisor primero; luego sumamos hoteles de OpenStreetMap (deduplicando
      // por nombre) para cubrir los que TripAdvisor no indexa.
      const [result, osmExtra] = await Promise.all([
        searchPlaces(value, form.city, 'hotels'),
        searchOsmPois(value, { cityText:form.city, ...(cityAnchor.current || {}) }).catch(() => [])
      ])
      const base = result?.places || []
      const seenNames = new Set(base.map(place => (place.name || '').trim().toLowerCase()))
      const merged = [...base, ...osmExtra.filter(place => !seenNames.has((place.name || '').trim().toLowerCase()))]
      setHotelResults(merged)
      setHotelBusy(false)
    }, 400)
  }

  const chooseHotel = hotel => {
    clearTimeout(hotelBlurTimer.current)
    setForm(current => ({
      ...current,
      name:hotel.name,
      address:hotel.address || '',
      latitude:hotel.latitude ?? null,
      longitude:hotel.longitude ?? null
    }))
    setHotelResults([])
  }

  // El nombre del hotel es libre: se puede escribir uno que no esté en las
  // listas (Tripadvisor/OSM). Esta salida cierra el desplegable conservando el
  // texto tal cual, sin obligar a elegir una opción ni vincular coordenadas.
  const keepCustomHotel = () => {
    clearTimeout(hotelBlurTimer.current)
    setHotelResults([])
  }

  const blurHotel = () => {
    // Cierra el desplegable al salir del campo (con delay para que el tap sobre
    // una opción alcance a registrarse antes de que la lista desaparezca).
    clearTimeout(hotelBlurTimer.current)
    hotelBlurTimer.current = setTimeout(() => setHotelResults([]), 160)
  }

  return (
    <div className="stack">
      {trip.hotels.map(hotel => (
        <article className="list-card" key={hotel.id}>
          <div>
            <small>{hotel.city}</small>
            <h3>{hotel.name}</h3>
            <p>{[hotel.checkIn && `${formatDate(hotel.checkIn)} → ${formatDate(hotel.checkOut) || '?'}`, hotel.address].filter(Boolean).join(' · ')}</p>
            {(hotel.cost > 0 || hotel.url) && (
              <p className="list-card-meta">
                {hotel.cost > 0 && <b>{hotel.cost} {hotel.costCurrency || trip.currency}</b>}
                {hotel.url && <a href={hotel.url} target="_blank" rel="noreferrer">Abrir reserva ↗</a>}
              </p>
            )}
          </div>
          <button className="icon-btn" onClick={() => deleteHotel(hotel.id)} aria-label="Eliminar hotel">✕</button>
        </article>
      ))}
      <form className="panel-card compact-form" onSubmit={submit}>
        <h3>Agregar hotel</h3>
        <div className="two-cols">
          <label className="autocomplete-field">Ciudad
            <input required autoComplete="off" value={form.city} onChange={e => changeCity(e.target.value)} placeholder="Ej. Las Vegas" />
            {(cityBusy || cityResults.length > 0) && <div className="autocomplete-results">
              {cityBusy ? <span>Buscando ciudades...</span> : cityResults.map(city => <button type="button" key={city.id} onClick={() => chooseCity(city)}>{city.name}</button>)}
            </div>}
          </label>
          <label className="autocomplete-field">Nombre
            <input required autoComplete="off" disabled={!form.city.trim()} value={form.name} onChange={e => changeHotel(e.target.value)} onBlur={blurHotel} placeholder={form.city ? 'Escribe el hotel' : 'Primero elige ciudad'} />
            {(hotelBusy || hotelResults.length > 0) && <div className="autocomplete-results hotel-results">
              {hotelBusy ? <span>Buscando hoteles...</span> : (
                <>
                  {form.name.trim().length >= 2 && (
                    <button type="button" className="autocomplete-keep" onMouseDown={e => e.preventDefault()} onClick={keepCustomHotel}>
                      <b>Usar “{form.name.trim()}”</b><small>Nombre personalizado, sin vincular al mapa</small>
                    </button>
                  )}
                  {hotelResults.slice(0, 5).map(hotel => (
                    <button type="button" key={hotel.locationId || hotel.name} onMouseDown={e => e.preventDefault()} onClick={() => chooseHotel(hotel)}>
                      <b>{hotel.name}</b><small>{[hotel.rating ? `★ ${hotel.rating}` : '', hotel.address].filter(Boolean).join(' · ')}</small>
                    </button>
                  ))}
                </>
              )}
            </div>}
          </label>
        </div>
        <label>Dirección<input value={form.address} onChange={e => setForm({ ...form, address:e.target.value })} /></label>
        <div className="two-cols">
          <label>Check-in<input type="date" value={form.checkIn} onChange={e => setForm({ ...form, checkIn:e.target.value })} /></label>
          <label>Check-out<input type="date" value={form.checkOut} onChange={e => setForm({ ...form, checkOut:e.target.value })} /></label>
        </div>
        <div className="two-cols">
          <label>Costo <span className="optional-label">opcional</span><input type="number" min="0" step="0.01" placeholder="0" value={form.cost} onChange={e => setForm({ ...form, cost:e.target.value })} /></label>
          <label>Moneda<input value={form.costCurrency} onChange={e => setForm({ ...form, costCurrency:e.target.value.toUpperCase() })} /></label>
        </div>
        <label>Enlace de la reserva <span className="optional-label">opcional</span>
          <input type="url" inputMode="url" placeholder="https://booking.com/… o Airbnb" value={form.url} onChange={e => setForm({ ...form, url:e.target.value })} />
        </label>
        {Number(form.cost) > 0 && (
          <label className="register-expense">
            <input type="checkbox" checked={form.register} onChange={e => setForm({ ...form, register:e.target.checked })} />
            <span>Registrar como gasto del viaje</span>
          </label>
        )}
        {form.register && Number(form.cost) > 0 && members.length > 1 && (
          <button type="button" className="split-summary-btn" onClick={() => setSplitOpen(true)}>
            Pagó {memberName(form.paidBy, members)} · {form.split?.members?.length ? `entre ${form.split.members.length}` : 'igual entre todos'} ✎
          </button>
        )}
        <button className="primary-btn compact">Agregar</button>
      </form>
      {splitOpen && (
        <SplitEditor amount={Number(form.cost) || 0} currency={form.costCurrency} members={members} currentUserId={user.id}
          value={{ paidBy:form.paidBy, split:form.split }} onCancel={() => setSplitOpen(false)}
          onSave={({ paidBy, split }) => { setForm(current => ({ ...current, paidBy, split })); setSplitOpen(false) }} />
      )}
    </div>
  )
}

const WALLET_KINDS = [
  { key:'ticket', label:'Ticket' },
  { key:'qr', label:'QR' },
  { key:'image', label:'Imagen' },
  { key:'pdf', label:'PDF' },
  { key:'other', label:'Otro' }
]
const KIND_LABEL = Object.fromEntries(WALLET_KINDS.map(item => [item.key, item.label]))
const KIND_ICON = { ticket:'🎟', qr:'🔳', image:'🖼', pdf:'📄', other:'📎' }

function Wallet({ trip }) {
  const { addAttachment, deleteAttachment, signAttachment } = useTrips()
  const fileRef = useRef(null)
  const [pendingFile, setPendingFile] = useState(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('ticket')
  const [activityId, setActivityId] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')
  const [urls, setUrls] = useState({})
  const [preview, setPreview] = useState(null)

  const docs = trip.documents || []
  const activities = useMemo(() => {
    const list = []
    for (const day of trip.days) for (const act of day.activities) list.push({ id:act.id, name:act.name, day:day.position })
    return list
  }, [trip.days])
  const activityName = id => activities.find(item => item.id === id)?.name || 'Panorama'
  const isImage = doc => doc.type === 'image' || (doc.mime || '').startsWith('image/') || (urls[doc.id] || '').startsWith('data:image')

  // Firma las URLs del bucket privado (o usa el data URL en modo local).
  useEffect(() => {
    let alive = true
    docs.forEach(doc => {
      if (urls[doc.id] !== undefined || !doc.storagePath) return
      signAttachment(doc.storagePath).then(url => { if (alive) setUrls(prev => ({ ...prev, [doc.id]:url })) })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs])

  const pickFile = event => {
    const file = event.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    setTitle(file.name.replace(/\.[^.]+$/, ''))
    setKind(file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'ticket')
  }

  const save = async () => {
    if (!pendingFile) return
    setBusy(true)
    const result = await addAttachment({ file:pendingFile, kind, title, activityId:activityId || null })
    setBusy(false)
    if (result !== null) {
      setPendingFile(null); setTitle(''); setKind('ticket'); setActivityId('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const cancel = () => { setPendingFile(null); if (fileRef.current) fileRef.current.value = '' }
  const taggedIds = [...new Set(docs.map(doc => doc.activityId).filter(Boolean))]
  const visible = docs.filter(doc => filter === 'all' ? true : filter === 'general' ? !doc.activityId : doc.activityId === filter)

  return (
    <div className="stack">
      <label className="wallet-upload">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={pickFile} hidden />
        <span>+ Subir ticket, QR o imagen</span>
        <small>Imágenes o PDF · se guardan en tu cartera</small>
      </label>

      {pendingFile && (
        <div className="panel-card compact-form">
          <h3>Guardar en la cartera</h3>
          <label>Título<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Ej. Entrada al museo" /></label>
          <div className="two-cols">
            <label>Tipo
              <select value={kind} onChange={event => setKind(event.target.value)}>
                {WALLET_KINDS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
            <label>Panorama <span className="optional-label">opcional</span>
              <select value={activityId} onChange={event => setActivityId(event.target.value)}>
                <option value="">— General —</option>
                {activities.map(item => <option key={item.id} value={item.id}>D{item.day} · {item.name}</option>)}
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="ghost-btn" onClick={cancel}>Cancelar</button>
            <button type="button" className="primary-btn compact" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="wallet-filters">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
          <button className={filter === 'general' ? 'active' : ''} onClick={() => setFilter('general')}>Generales</button>
          {taggedIds.map(id => (
            <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{activityName(id)}</button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="empty-panel"><p>Tu cartera está vacía. Sube tus tickets, QR o reservas para tenerlos a mano.</p></div>
      ) : (
        <div className="wallet-grid">
          {visible.map(doc => (
            <article className="wallet-item" key={doc.id}>
              <button type="button" className="wallet-thumb" onClick={() => urls[doc.id] && setPreview({ ...doc, url:urls[doc.id] })}>
                {isImage(doc) && urls[doc.id]
                  ? <img src={urls[doc.id]} alt={doc.name} loading="lazy" />
                  : <span className="wallet-icon">{KIND_ICON[doc.type] || '📎'}</span>}
              </button>
              <div className="wallet-meta">
                <b>{doc.name}</b>
                <small>{[KIND_LABEL[doc.type] || 'Archivo', doc.activityId ? activityName(doc.activityId) : 'General'].join(' · ')}</small>
              </div>
              <button className="icon-btn" onClick={() => deleteAttachment(doc)} aria-label="Eliminar de la cartera">✕</button>
            </article>
          ))}
        </div>
      )}

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="wallet-preview" onClick={event => event.stopPropagation()}>
            {(preview.type === 'image' || (preview.mime || '').startsWith('image/') || preview.url.startsWith('data:image'))
              ? <img src={preview.url} alt={preview.name} />
              : <iframe title={preview.name} src={preview.url} />}
            <div className="modal-actions">
              <a className="ghost-btn" href={preview.url} target="_blank" rel="noreferrer">Abrir ↗</a>
              <button type="button" className="primary-btn compact" onClick={() => setPreview(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const CATEGORY_LABELS = { food:'Comida', transport:'Transporte', hotel:'Hotel', activity:'Actividad', other:'Otro' }
const CATEGORY_ICONS = { food:'🍽', transport:'🚗', hotel:'🏨', activity:'⭐', other:'📌' }

function Expenses({ trip }) {
  const { user } = useAuth()
  const { addExpense, updateExpense, deleteExpense } = useTrips()
  const members = trip.members.filter(member => member.status === 'active')
  const nameOf = userId => { const m = members.find(member => member.userId === userId); return m?.name || m?.email || 'Miembro' }
  const today = new Date().toISOString().slice(0, 10)
  const emptyForm = { description:'', amount:'', currency:trip.currency || 'USD', date:today, paidBy:user.id, category:'food', split:{}, activityId:'' }
  const [form, setForm] = useState(emptyForm)
  const [expanded, setExpanded] = useState(false)
  const [payerFilter, setPayerFilter] = useState('all')
  const [originFilter, setOriginFilter] = useState('all')
  const [splitOpen, setSplitOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editSplitOpen, setEditSplitOpen] = useState(false)
  const grouped = useMemo(() => {
    const totals = {}
    for (const expense of trip.expenses) if (!expense.isSettlement) totals[expense.currency] = (totals[expense.currency] || 0) + expense.amount
    return totals
  }, [trip.expenses])

  const allActivities = useMemo(() => {
    const list = []
    for (const day of trip.days) for (const act of day.activities) list.push({ id:act.id, name:act.name, dayPosition:day.position, city:day.city })
    return list
  }, [trip.days])

  const activityName = activityId => {
    for (const day of trip.days) { const act = day.activities.find(a => a.id === activityId); if (act) return act.name }
    return null
  }

  const splitSummary = expense => {
    const sp = expense.split
    if (!sp || !sp.members || !sp.members.length) return 'entre todos'
    if (sp.members.length === 1) return 'personal'
    if (sp.mode && sp.mode !== 'equal') return `entre ${sp.members.length}`
    if (sp.members.length === members.length) return 'entre todos'
    return `entre ${sp.members.length}`
  }
  const categoryOf = expense => {
    if (expense.isSettlement) return 'settle'
    if (expense.activityId) return 'activity'
    if (expense.hotelId) return 'hotel'
    return expense.category || 'other'
  }
  // Desglose de gasto por TIPO y moneda (los pagos de saldo no cuentan como gasto).
  const byType = useMemo(() => {
    const totals = {}
    for (const expense of trip.expenses) {
      if (expense.isSettlement) continue
      const type = expense.activityId ? 'activity' : expense.hotelId ? 'hotel' : (expense.category || 'other')
      totals[type] = totals[type] || {}
      totals[type][expense.currency] = (totals[type][expense.currency] || 0) + expense.amount
    }
    return totals
  }, [trip.expenses])
  // La clave de filtro para un tipo ('activity' se filtra como 'panorama').
  const filterKeyForType = type => (type === 'activity' ? 'panorama' : type)
  const matchesOrigin = expense => {
    if (originFilter === 'all') return true
    if (originFilter === 'panorama') return !!expense.activityId
    if (originFilter === 'hotel') return !!expense.hotelId || expense.category === 'hotel'
    if (originFilter === 'food') return !expense.activityId && !expense.hotelId && expense.category === 'food'
    if (originFilter === 'transport') return !expense.activityId && !expense.hotelId && expense.category === 'transport'
    return !expense.activityId && !expense.hotelId && !['food','transport','hotel'].includes(expense.category)
  }

  const submit = async event => {
    event.preventDefault()
    const activeIds = members.map(member => member.userId)
    const split = resolveSplit(form.split, Number(form.amount), activeIds)
    const values = { ...form, split }
    if (form.activityId) { values.activityId = form.activityId; values.category = 'activity' }
    const result = await addExpense(values)
    if (result !== null) setForm(current => ({ ...emptyForm, currency:current.currency, paidBy:current.paidBy }))
  }

  const startEdit = expense => {
    setEditing({ ...expense, amount:String(expense.amount) })
    setEditSplitOpen(false)
  }
  const saveEdit = async () => {
    if (!editing) return
    const activeIds = members.map(member => member.userId)
    const split = resolveSplit(editing.split || {}, Number(editing.amount), activeIds)
    await updateExpense(editing.id, {
      description:editing.description, amount:Number(editing.amount), currency:editing.currency,
      category:editing.category, date:editing.date, paidBy:editing.paidBy, split
    })
    setEditing(null)
  }

  const recordSettle = async (transfer, currency) => {
    await addExpense({
      description:`${nameOf(transfer.from)} → ${nameOf(transfer.to)}`,
      amount:transfer.amount, currency, category:'other', date:today,
      paidBy:transfer.from, isSettlement:true,
      split:{ mode:'equal', members:[transfer.to], amounts:{ [transfer.to]:transfer.amount } }
    })
  }

  const filtered = trip.expenses.filter(expense => (payerFilter === 'all' || expense.paidBy === payerFilter) && matchesOrigin(expense))

  return (
    <div className="stack">
      <form className="expense-form" onSubmit={submit}>
        <div className="expense-form-row">
          <input aria-label="Monto" required min="0" step="0.01" type="number" inputMode="decimal" placeholder="Monto" value={form.amount} onChange={e => setForm({ ...form, amount:e.target.value })} />
          <input aria-label="Descripción" required placeholder="Descripción" value={form.description} onChange={e => setForm({ ...form, description:e.target.value })} />
          <button className="primary-btn compact" type="submit">+</button>
        </div>
        <div className="expense-categories">{['food','transport','hotel','activity','other'].map(category => <button type="button" className={form.category === category ? 'active' : ''} key={category} onClick={() => setForm({ ...form, category })}>{CATEGORY_ICONS[category]} {CATEGORY_LABELS[category]}</button>)}</div>
        <button type="button" className="more-options" onClick={() => setExpanded(value => !value)}>{expanded ? 'menos opciones' : 'más opciones'}</button>
        {expanded && <div className="expense-options">
          <div className="two-cols">
            <label>Moneda<input value={form.currency} onChange={e => setForm({ ...form, currency:e.target.value.toUpperCase() })} /></label>
            <label>Fecha<input type="date" value={form.date} onChange={e => setForm({ ...form, date:e.target.value })} /></label>
          </div>
          {allActivities.length > 0 && (
            <label>Vincular a panorama <span className="optional-label">opcional</span>
              <select value={form.activityId} onChange={e => { const id = e.target.value; const act = allActivities.find(a => a.id === id); setForm(current => ({ ...current, activityId:id, description:act && !current.description ? act.name : current.description, category:id ? 'activity' : current.category })) }}>
                <option value="">Sin vincular</option>
                {allActivities.map(act => <option key={act.id} value={act.id}>Día {act.dayPosition}: {act.name}</option>)}
              </select>
            </label>
          )}
          {members.length > 1
            ? <button type="button" className="split-summary-btn" onClick={() => setSplitOpen(true)}>
                Pagó {nameOf(form.paidBy)} · {form.split?.members?.length ? (form.split.members.length === 1 ? 'personal' : `entre ${form.split.members.length}`) : 'igual entre todos'} ✎
              </button>
            : <select aria-label="Pagado por" value={form.paidBy} onChange={e => setForm({ ...form, paidBy:e.target.value })}>{members.map(member => <option key={member.id} value={member.userId}>{member.name || member.email}</option>)}</select>}
        </div>}
      </form>
      <div className="expense-filters">
        {members.length > 1 && <div className="payer-filters"><button className={payerFilter === 'all' ? 'active' : ''} onClick={() => setPayerFilter('all')}>Todos</button>{members.map(member => <button className={payerFilter === member.userId ? 'active' : ''} key={member.id} onClick={() => setPayerFilter(member.userId)}>{member.name || member.email}</button>)}</div>}
      </div>
      {Object.keys(grouped).length > 0 && <div className="totals-row">
        {Object.entries(grouped).map(([currency, total]) => <div key={currency}><small>Total {currency}</small><b>{money(total, currency)}</b></div>)}
      </div>}
      {Object.keys(byType).length > 0 && (
        <div className="expense-breakdown">
          {['activity', 'hotel', 'food', 'transport', 'other'].filter(type => byType[type]).map(type => {
            const fk = filterKeyForType(type)
            const active = originFilter === fk
            const label = type === 'activity' ? 'Panoramas' : CATEGORY_LABELS[type]
            const amounts = Object.entries(byType[type]).map(([currency, amount]) => money(amount, currency)).join(' · ')
            return (
              <button type="button" key={type} className={`breakdown-chip ${active ? 'active' : ''}`}
                onClick={() => setOriginFilter(current => current === fk ? 'all' : fk)}
                aria-pressed={active}>
                <span className="bd-icon">{CATEGORY_ICONS[type]}</span>
                <span className="bd-label">{label}</span>
                <b>{amounts}</b>
              </button>
            )
          })}
          {originFilter !== 'all' && <button type="button" className="breakdown-clear" onClick={() => setOriginFilter('all')}>Ver todos ✕</button>}
        </div>
      )}
      {filtered.map(expense => {
        const cat = categoryOf(expense)
        const linkedName = expense.activityId ? activityName(expense.activityId) : null
        return (
          <div className="expense-card" key={expense.id}>
            <button type="button" className="expense-card-main" onClick={() => startEdit(expense)}>
              <span className={`expense-icon ${cat}`}>{cat === 'settle' ? '🤝' : (CATEGORY_ICONS[cat] || '📌')}</span>
              <div className="expense-info">
                <h4>{expense.description}</h4>
                <small>{[formatDate(expense.date), nameOf(expense.paidBy), splitSummary(expense)].filter(Boolean).join(' · ')}</small>
                {linkedName && <small className="expense-link">↳ {linkedName}</small>}
              </div>
              <div className="expense-amount">
                <b>{money(expense.amount, expense.currency)}</b>
                <small>{CATEGORY_LABELS[cat] || (cat === 'settle' ? 'Pago' : 'Otro')}</small>
              </div>
            </button>
            <button type="button" className="expense-delete" onClick={() => deleteExpense(expense.id)} aria-label={`Eliminar gasto ${expense.description}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M18 7l-1 13H7L6 7M10 11v5M14 11v5" /></svg>
            </button>
          </div>
        )
      })}
      {!filtered.length && trip.expenses.length > 0 && <p className="expense-empty">Sin gastos en este filtro</p>}
      {!trip.expenses.length && <p className="expense-empty">Aún no hay gastos registrados</p>}
      {members.length > 0 && Object.keys(grouped).map(currency => {
        const { net } = computeBalances(trip.expenses, members, currency)
        const transfers = settleUp(members.map(member => ({ id:member.userId, amount:net[member.userId] || 0 })))
        return (
          <div className="panel-card balance-card" key={currency}>
            <h3>Balance {currency}</h3>
            {members.map(member => {
              const value = net[member.userId] || 0
              const state = Math.abs(value) < .01 ? 'Al día' : value > 0 ? `Le deben ${money(value, currency)}` : `Debe ${money(Math.abs(value), currency)}`
              return <div className="balance-line" key={member.id}><span>{member.name || member.email || 'Miembro'}</span><b className={value > .01 ? 'positive' : value < -.01 ? 'negative' : ''}>{state}</b></div>
            })}
            {transfers.length > 0 && <div className="settle-list">
              <b>Para quedar al día</b>
              {transfers.map((transfer, index) => (
                <div className="settle-row" key={index}>
                  <span>{nameOf(transfer.from)} → {nameOf(transfer.to)}: {money(transfer.amount, currency)}</span>
                  <button className="settle-btn" onClick={() => recordSettle(transfer, currency)}>Registrar pago</button>
                </div>
              ))}
            </div>}
          </div>
        )
      })}

      {editing && (
        <div className="split-editor" onClick={() => setEditing(null)}>
          <div className="split-sheet" onClick={event => event.stopPropagation()}>
            <div className="composer-heading">
              <div><span>EDITAR GASTO</span><h4>{editing.description}</h4></div>
              <button type="button" className="icon-btn" onClick={() => setEditing(null)} aria-label="Cerrar">✕</button>
            </div>
            <label>Descripción<input value={editing.description} onChange={e => setEditing({ ...editing, description:e.target.value })} /></label>
            <div className="two-cols">
              <label>Monto<input type="number" min="0" step="0.01" value={editing.amount} onChange={e => setEditing({ ...editing, amount:e.target.value })} /></label>
              <label>Moneda<input value={editing.currency} onChange={e => setEditing({ ...editing, currency:e.target.value.toUpperCase() })} /></label>
            </div>
            <div className="two-cols">
              <label>Categoría
                <select value={editing.category} onChange={e => setEditing({ ...editing, category:e.target.value })}>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label>Fecha<input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date:e.target.value })} /></label>
            </div>
            {members.length > 1 && (
              <button type="button" className="split-summary-btn" onClick={() => setEditSplitOpen(true)}>
                Pagó {nameOf(editing.paidBy)} · {editing.split?.members?.length ? (editing.split.members.length === 1 ? 'personal' : `entre ${editing.split.members.length}`) : 'igual entre todos'} ✎
              </button>
            )}
            <div className="edit-actions">
              <button type="button" className="delete-expense-btn" onClick={() => { deleteExpense(editing.id); setEditing(null) }}>Eliminar gasto</button>
              <button className="primary-btn compact" onClick={saveEdit} disabled={!editing.description || !Number(editing.amount)}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editSplitOpen && editing && (
        <SplitEditor
          amount={Number(editing.amount) || 0}
          currency={editing.currency}
          members={members}
          currentUserId={user.id}
          value={{ paidBy:editing.paidBy, split:editing.split }}
          onCancel={() => setEditSplitOpen(false)}
          onSave={({ paidBy, split }) => { setEditing(current => ({ ...current, paidBy, split })); setEditSplitOpen(false) }}
        />
      )}

      {splitOpen && (
        <SplitEditor
          amount={Number(form.amount) || 0}
          currency={form.currency}
          members={members}
          currentUserId={user.id}
          value={{ paidBy:form.paidBy, split:form.split }}
          onCancel={() => setSplitOpen(false)}
          onSave={({ paidBy, split }) => { setForm(current => ({ ...current, paidBy, split })); setSplitOpen(false) }}
        />
      )}
    </div>
  )
}

const packingTemplates = {
  Playa:['Traje de baño','Protector solar','Toalla','Sandalias','Sombrero','Lentes de sol','Bolsa impermeable','Ropa ligera','Repelente','Botella de agua'],
  Ciudad:['Zapatillas cómodas','Chaqueta ligera','Cargador portátil','Mochila pequeña','Paraguas','Botella de agua','Mapa offline','Audífonos','Documento de identidad','Tarjeta de transporte'],
  Trekking:['Botas de trekking','Calcetines técnicos','Cortaviento','Linterna frontal','Botiquín','Bastones','Protector solar','Agua','Snacks','Mapa offline'],
  Internacional:['Pasaporte','Seguro de viaje','Adaptador universal','Reservas descargadas','Tarjetas','Algo de efectivo','Medicamentos','Cargadores','Copia de documentos','Chip o eSIM']
}

function Packing({ trip, onOpenAssistant }) {
  const { addPackingItem, addPackingItems, togglePackingItem, deletePackingItem } = useTrips()
  const [item, setItem] = useState('')
  const packed = trip.packingItems.filter(entry => entry.packed).length

  const submit = async event => {
    event.preventDefault()
    const result = await addPackingItem(item.trim())
    if (result !== null) setItem('')
  }

  return (
    <div className="panel-card">
      <div className="packing-progress"><div><h3>Equipaje</h3><p>{packed} de {trip.packingItems.length} listos</p></div><b>{trip.packingItems.length ? Math.round(packed / trip.packingItems.length * 100) : 0}%</b></div>
      <div className="progress-track"><span style={{ width:`${trip.packingItems.length ? packed / trip.packingItems.length * 100 : 0}%` }} /></div>
      <div className="packing-templates" aria-label="Plantillas de equipaje">
        {Object.entries(packingTemplates).map(([name, items]) => <button key={name} onClick={() => addPackingItems(items)}>{name}</button>)}
        {onOpenAssistant && <button onClick={() => onOpenAssistant('Arma mi lista de equipaje para este viaje considerando destino, fechas y clima. Agrega los ítems útiles directamente al viaje.')}>✦ Generar con IA</button>}
      </div>
      {trip.packingItems.map(entry => (
        <div className="packing-line" key={entry.id}>
          <input type="checkbox" checked={entry.packed} onChange={() => togglePackingItem(entry.id)} />
          <span className={entry.packed ? 'packed' : ''}>{entry.item}</span>
          <button className="icon-btn" onClick={() => deletePackingItem(entry.id)}>✕</button>
        </div>
      ))}
      <form className="inline-form" onSubmit={submit}>
        <input required placeholder="Agregar al equipaje" value={item} onChange={e => setItem(e.target.value)} />
        <button className="primary-btn compact">+</button>
      </form>
    </div>
  )
}
