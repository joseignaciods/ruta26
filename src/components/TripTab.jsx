import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/AuthContext.jsx'
import { useTrips } from '../state/TripContext.jsx'
import { formatDate } from '../lib/planner.js'
import { settleUp } from '../lib/settle.js'
import { searchCities } from '../lib/geo.js'
import { computeBalances, resolveSplit } from '../lib/computeBalances.js'
import SplitEditor from './SplitEditor.jsx'

const money = (amount, currency) => `${Number(amount || 0).toLocaleString('es-CL', { maximumFractionDigits:2 })} ${currency}`
const memberName = (userId, members) => { const member = members.find(item => item.userId === userId); return member?.name || member?.email || 'Miembro' }

export default function TripTab({ onOpenAssistant }) {
  const [section, setSection] = useState('hotels')
  const { activeTrip } = useTrips()

  return (
    <section>
      <div className="section-heading"><div><h2>Viaje</h2><p>Reservas, gastos y equipaje</p></div></div>
      <div className="subtabs">
        <button className={section === 'hotels' ? 'active' : ''} onClick={() => setSection('hotels')}>Hoteles</button>
        <button className={section === 'expenses' ? 'active' : ''} onClick={() => setSection('expenses')}>Gastos</button>
        <button className={section === 'packing' ? 'active' : ''} onClick={() => setSection('packing')}>Equipaje</button>
      </div>
      {section === 'hotels' && <Hotels trip={activeTrip} />}
      {section === 'expenses' && <Expenses trip={activeTrip} />}
      {section === 'packing' && <Packing trip={activeTrip} onOpenAssistant={onOpenAssistant} />}
    </section>
  )
}

function Hotels({ trip }) {
  const { user } = useAuth()
  const { addHotel, deleteHotel, searchPlaces } = useTrips()
  const members = trip.members.filter(member => member.status === 'active')
  const emptyHotel = { name:'', city:'', address:'', checkIn:'', checkOut:'', latitude:null, longitude:null, cost:'', costCurrency:trip.currency || 'USD', register:false, paidBy:user.id, split:{} }
  const [form, setForm] = useState(emptyHotel)
  const [splitOpen, setSplitOpen] = useState(false)
  const [cityResults, setCityResults] = useState([])
  const [hotelResults, setHotelResults] = useState([])
  const [cityBusy, setCityBusy] = useState(false)
  const [hotelBusy, setHotelBusy] = useState(false)
  const cityTimer = useRef(null)
  const hotelTimer = useRef(null)

  useEffect(() => () => {
    clearTimeout(cityTimer.current)
    clearTimeout(hotelTimer.current)
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
    setCityResults([])
  }

  const changeHotel = value => {
    setForm(current => ({ ...current, name:value, address:'', latitude:null, longitude:null }))
    clearTimeout(hotelTimer.current)
    if (form.city.trim().length < 2 || value.trim().length < 2) { setHotelResults([]); return }
    hotelTimer.current = setTimeout(async () => {
      setHotelBusy(true)
      const result = await searchPlaces(value, form.city, 'hotels')
      setHotelResults(result?.places || [])
      setHotelBusy(false)
    }, 400)
  }

  const chooseHotel = hotel => {
    setForm(current => ({
      ...current,
      name:hotel.name,
      address:hotel.address || '',
      latitude:hotel.latitude ?? null,
      longitude:hotel.longitude ?? null
    }))
    setHotelResults([])
  }

  return (
    <div className="stack">
      {trip.hotels.map(hotel => (
        <article className="list-card" key={hotel.id}>
          <div><small>{hotel.city}</small><h3>{hotel.name}</h3><p>{[hotel.checkIn && `${formatDate(hotel.checkIn)} → ${formatDate(hotel.checkOut) || '?'}`, hotel.address].filter(Boolean).join(' · ')}</p></div>
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
            <input required autoComplete="off" disabled={!form.city.trim()} value={form.name} onChange={e => changeHotel(e.target.value)} placeholder={form.city ? 'Escribe el hotel' : 'Primero elige ciudad'} />
            {(hotelBusy || hotelResults.length > 0) && <div className="autocomplete-results hotel-results">
              {hotelBusy ? <span>Buscando hoteles...</span> : hotelResults.slice(0, 5).map(hotel => (
                <button type="button" key={hotel.locationId || hotel.name} onClick={() => chooseHotel(hotel)}>
                  <b>{hotel.name}</b><small>{[hotel.rating ? `★ ${hotel.rating}` : '', hotel.address].filter(Boolean).join(' · ')}</small>
                </button>
              ))}
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

const CATEGORY_LABELS = { food:'Comida', transport:'Transporte', hotel:'Hotel', activity:'Actividad', other:'Otro' }
const ORIGIN_FILTERS = [
  { key:'all', label:'Todos' },
  { key:'panorama', label:'Panorama' },
  { key:'hotel', label:'Hotel' },
  { key:'food', label:'Comida' },
  { key:'transport', label:'Transporte' },
  { key:'other', label:'Otro' }
]

function Expenses({ trip }) {
  const { user } = useAuth()
  const { addExpense, updateExpense, deleteExpense } = useTrips()
  const members = trip.members.filter(member => member.status === 'active')
  const nameOf = userId => { const m = members.find(member => member.userId === userId); return m?.name || m?.email || 'Miembro' }
  const today = new Date().toISOString().slice(0, 10)
  const emptyForm = { description:'', amount:'', currency:trip.currency || 'USD', date:today, paidBy:user.id, category:'food', split:{} }
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

  const splitSummary = expense => {
    const sp = expense.split
    if (!sp || !sp.members || !sp.members.length) return 'entre todos'
    if (sp.members.length === 1) return 'personal'
    if (sp.mode && sp.mode !== 'equal') return `repartido entre ${sp.members.length}`
    if (sp.members.length === members.length) return 'entre todos'
    return `entre ${sp.members.length}`
  }
  const originLabel = expense => {
    if (expense.isSettlement) return 'Pago'
    return expense.activityId ? 'Panorama' : expense.hotelId ? 'Hotel' : (CATEGORY_LABELS[expense.category] || expense.category)
  }
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
    const result = await addExpense({ ...form, split })
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

  return (
    <div className="stack">
      <form className="quick-expense" onSubmit={submit}>
        <input aria-label="Monto" required min="0" step="0.01" type="number" placeholder="Monto" value={form.amount} onChange={e => setForm({ ...form, amount:e.target.value })} />
        <input aria-label="Descripción" required placeholder="Descripción" value={form.description} onChange={e => setForm({ ...form, description:e.target.value })} />
        <button className="primary-btn compact">+</button>
        <button type="button" className="more-options" onClick={() => setExpanded(value => !value)}>{expanded ? 'menos opciones' : 'más opciones'}</button>
        {expanded && <div className="expense-options">
          <div className="expense-categories">{['food','transport','hotel','activity','other'].map(category => <button type="button" className={form.category === category ? 'active' : ''} key={category} onClick={() => setForm({ ...form, category })}>{CATEGORY_LABELS[category] || category}</button>)}</div>
          <input aria-label="Moneda" value={form.currency} onChange={e => setForm({ ...form, currency:e.target.value.toUpperCase() })} />
          <input aria-label="Fecha" type="date" value={form.date} onChange={e => setForm({ ...form, date:e.target.value })} />
          {members.length > 1
            ? <button type="button" className="split-summary-btn" onClick={() => setSplitOpen(true)}>
                Pagó {nameOf(form.paidBy)} · {form.split?.members?.length ? (form.split.members.length === 1 ? 'personal' : `entre ${form.split.members.length}`) : 'igual entre todos'} ✎
              </button>
            : <select aria-label="Pagado por" value={form.paidBy} onChange={e => setForm({ ...form, paidBy:e.target.value })}>{members.map(member => <option key={member.id} value={member.userId}>{member.name || member.email}</option>)}</select>}
        </div>}
      </form>
      <div className="expense-filters">
        <div className="payer-filters"><button className={payerFilter === 'all' ? 'active' : ''} onClick={() => setPayerFilter('all')}>Todos</button>{members.map(member => <button className={payerFilter === member.userId ? 'active' : ''} key={member.id} onClick={() => setPayerFilter(member.userId)}>{member.name || member.email}</button>)}</div>
        <div className="payer-filters">{ORIGIN_FILTERS.map(f => <button className={originFilter === f.key ? 'active' : ''} key={f.key} onClick={() => setOriginFilter(f.key)}>{f.label}</button>)}</div>
      </div>
      {Object.keys(grouped).length > 0 && <div className="totals-row">
        {Object.entries(grouped).map(([currency, total]) => <div key={currency}><small>Total {currency}</small><b>{money(total, currency)}</b></div>)}
      </div>}
      {trip.expenses.filter(expense => (payerFilter === 'all' || expense.paidBy === payerFilter) && matchesOrigin(expense)).map(expense => (
        <article className="list-card" key={expense.id}>
          <button className="expense-copy" onClick={() => startEdit(expense)}><i>{originLabel(expense)}</i><small>{formatDate(expense.date) || 'Sin fecha'} · {nameOf(expense.paidBy)} · {splitSummary(expense)}</small><h3>{expense.description}</h3><p>{money(expense.amount, expense.currency)}</p></button>
          <button className="icon-btn" onClick={() => deleteExpense(expense.id)} aria-label="Eliminar gasto">✕</button>
        </article>
      ))}
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
            <button className="primary-btn compact" onClick={saveEdit} disabled={!editing.description || !Number(editing.amount)}>Guardar cambios</button>
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
