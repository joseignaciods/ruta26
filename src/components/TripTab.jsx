import { useMemo, useState } from 'react'
import { useAuth } from '../state/AuthContext.jsx'
import { useTrips } from '../state/TripContext.jsx'

const money = (amount, currency) => `${Number(amount || 0).toLocaleString('es-CL', { maximumFractionDigits:2 })} ${currency}`

export default function TripTab() {
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
      {section === 'packing' && <Packing trip={activeTrip} />}
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
          <div><small>{hotel.city}</small><h3>{hotel.name}</h3><p>{[hotel.checkIn && `${hotel.checkIn} → ${hotel.checkOut || '?'}`, hotel.address].filter(Boolean).join(' · ')}</p></div>
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
  const [form, setForm] = useState({ description:'', amount:'', currency:trip.currency || 'USD', date:'', paidBy:user.id })
  const grouped = useMemo(() => {
    const totals = {}
    for (const expense of trip.expenses) totals[expense.currency] = (totals[expense.currency] || 0) + expense.amount
    return totals
  }, [trip.expenses])

  const submit = async event => {
    event.preventDefault()
    const result = await addExpense(form)
    if (result !== null) setForm(current => ({ ...current, description:'', amount:'', date:'' }))
  }

  return (
    <div className="stack">
      {Object.keys(grouped).length > 0 && <div className="totals-row">
        {Object.entries(grouped).map(([currency, total]) => <div key={currency}><small>Total {currency}</small><b>{money(total, currency)}</b></div>)}
      </div>}
      {trip.expenses.map(expense => {
        const payer = members.find(member => member.userId === expense.paidBy)
        return <article className="list-card" key={expense.id}>
          <div><small>{expense.date || 'Sin fecha'} · {payer?.name || payer?.email || 'Miembro'}</small><h3>{expense.description}</h3><p>{money(expense.amount, expense.currency)}</p></div>
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
        </div>
      ))}
      <form className="panel-card compact-form" onSubmit={submit}>
        <h3>Registrar gasto</h3>
        <label>Descripción<input required value={form.description} onChange={e => setForm({ ...form, description:e.target.value })} /></label>
        <div className="three-cols">
          <label>Monto<input required min="0" step="0.01" type="number" value={form.amount} onChange={e => setForm({ ...form, amount:e.target.value })} /></label>
          <label>Moneda<input required value={form.currency} onChange={e => setForm({ ...form, currency:e.target.value.toUpperCase() })} /></label>
          <label>Fecha<input type="date" value={form.date} onChange={e => setForm({ ...form, date:e.target.value })} /></label>
        </div>
        <label>Pagado por<select value={form.paidBy} onChange={e => setForm({ ...form, paidBy:e.target.value })}>
          {members.map(member => <option key={member.id} value={member.userId}>{member.name || member.email || 'Miembro'}</option>)}
        </select></label>
        <button className="primary-btn compact">Agregar</button>
      </form>
    </div>
  )
}

function Packing({ trip }) {
  const { addPackingItem, togglePackingItem, deletePackingItem } = useTrips()
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
