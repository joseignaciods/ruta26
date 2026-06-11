import { useMemo, useState } from 'react'
import { useAuth } from '../state/AuthContext.jsx'
import { useTrips } from '../state/TripContext.jsx'
import { formatDate } from '../lib/planner.js'
import { settleUp } from '../lib/settle.js'

const money = (amount, currency) => `${Number(amount || 0).toLocaleString('es-CL', { maximumFractionDigits:2 })} ${currency}`

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
  const { addHotel, deleteHotel } = useTrips()
  const [form, setForm] = useState({ name:'', city:'', address:'', checkIn:'', checkOut:'' })

  const submit = async event => {
    event.preventDefault()
    const result = await addHotel(form)
    if (result !== null) setForm({ name:'', city:'', address:'', checkIn:'', checkOut:'' })
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
          <label>Nombre<input required value={form.name} onChange={e => setForm({ ...form, name:e.target.value })} /></label>
          <label>Ciudad<input required value={form.city} onChange={e => setForm({ ...form, city:e.target.value })} /></label>
        </div>
        <label>Dirección<input value={form.address} onChange={e => setForm({ ...form, address:e.target.value })} /></label>
        <div className="two-cols">
          <label>Check-in<input type="date" value={form.checkIn} onChange={e => setForm({ ...form, checkIn:e.target.value })} /></label>
          <label>Check-out<input type="date" value={form.checkOut} onChange={e => setForm({ ...form, checkOut:e.target.value })} /></label>
        </div>
        <button className="primary-btn compact">Agregar</button>
      </form>
    </div>
  )
}

function Expenses({ trip }) {
  const { user } = useAuth()
  const { addExpense, deleteExpense } = useTrips()
  const members = trip.members.filter(member => member.status === 'active')
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ description:'', amount:'', currency:trip.currency || 'USD', date:today, paidBy:user.id, category:'food' })
  const [expanded, setExpanded] = useState(false)
  const [payerFilter, setPayerFilter] = useState('all')
  const grouped = useMemo(() => {
    const totals = {}
    for (const expense of trip.expenses) totals[expense.currency] = (totals[expense.currency] || 0) + expense.amount
    return totals
  }, [trip.expenses])

  const submit = async event => {
    event.preventDefault()
    const result = await addExpense(form)
    if (result !== null) setForm(current => ({ ...current, description:'', amount:'' }))
  }

  return (
    <div className="stack">
      <form className="quick-expense" onSubmit={submit}>
        <input aria-label="Monto" required min="0" step="0.01" type="number" placeholder="Monto" value={form.amount} onChange={e => setForm({ ...form, amount:e.target.value })} />
        <input aria-label="Descripción" required placeholder="Descripción" value={form.description} onChange={e => setForm({ ...form, description:e.target.value })} />
        <button className="primary-btn compact">+</button>
        <button type="button" className="more-options" onClick={() => setExpanded(value => !value)}>{expanded ? 'menos opciones' : 'más opciones'}</button>
        {expanded && <div className="expense-options">
          <div className="expense-categories">{['food','transport','hotel','activity','other'].map(category => <button type="button" className={form.category === category ? 'active' : ''} key={category} onClick={() => setForm({ ...form, category })}>{category}</button>)}</div>
          <input aria-label="Moneda" value={form.currency} onChange={e => setForm({ ...form, currency:e.target.value.toUpperCase() })} />
          <input aria-label="Fecha" type="date" value={form.date} onChange={e => setForm({ ...form, date:e.target.value })} />
          <select aria-label="Pagado por" value={form.paidBy} onChange={e => setForm({ ...form, paidBy:e.target.value })}>{members.map(member => <option key={member.id} value={member.userId}>{member.name || member.email}</option>)}</select>
        </div>}
      </form>
      <div className="payer-filters"><button className={payerFilter === 'all' ? 'active' : ''} onClick={() => setPayerFilter('all')}>Todos</button>{members.map(member => <button className={payerFilter === member.userId ? 'active' : ''} key={member.id} onClick={() => setPayerFilter(member.userId)}>{member.name || member.email}</button>)}</div>
      {Object.keys(grouped).length > 0 && <div className="totals-row">
        {Object.entries(grouped).map(([currency, total]) => <div key={currency}><small>Total {currency}</small><b>{money(total, currency)}</b></div>)}
      </div>}
      {trip.expenses.filter(expense => payerFilter === 'all' || expense.paidBy === payerFilter).map(expense => {
        const payer = members.find(member => member.userId === expense.paidBy)
        return <article className="list-card" key={expense.id}>
          <div className="expense-copy"><i>{expense.category}</i><small>{formatDate(expense.date) || 'Sin fecha'} · {payer?.name || payer?.email || 'Miembro'}</small><h3>{expense.description}</h3><p>{money(expense.amount, expense.currency)}</p></div>
          <button className="icon-btn" onClick={() => deleteExpense(expense.id)} aria-label="Eliminar gasto">✕</button>
        </article>
      })}
      {members.length > 0 && Object.entries(grouped).map(([currency, total]) => (
        <div className="panel-card balance-card" key={currency}>
          <h3>Balance {currency}</h3>
          {members.map(member => {
            const paid = trip.expenses.filter(item => item.currency === currency && item.paidBy === member.userId).reduce((sum, item) => sum + item.amount, 0)
            const net = paid - total / members.length
            const state = Math.abs(net) < .01 ? 'Al día' : net > 0 ? `Le deben ${money(net, currency)}` : `Debe ${money(Math.abs(net), currency)}`
            return <div className="balance-line" key={member.id}><span>{member.name || member.email || 'Miembro'}</span><b className={net > .01 ? 'positive' : net < -.01 ? 'negative' : ''}>{state}</b></div>
          })}
          <div className="settle-list">
            <b>Para quedar al día</b>
            {settleUp(members.map(member => ({
              id:member.userId,
              amount:trip.expenses.filter(item => item.currency === currency && item.paidBy === member.userId).reduce((sum, item) => sum + item.amount, 0) - total / members.length
            }))).map((transfer, index) => {
              const from = members.find(member => member.userId === transfer.from)
              const to = members.find(member => member.userId === transfer.to)
              return <span key={index}>{from?.name || from?.email} → {to?.name || to?.email}: {money(transfer.amount, currency)}</span>
            })}
          </div>
        </div>
      ))}
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
