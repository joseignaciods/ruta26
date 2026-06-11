import { useEffect, useMemo, useState } from 'react'
import { geocodeCity, getWeather } from '../lib/geo.js'
import { formatDate } from '../lib/planner.js'
import { useTrips } from '../state/TripContext.jsx'

const mapsUrl = item => item.latitude != null && item.longitude != null
  ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`
  : item.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`
    : ''

export default function TodayTab({ onOpenAssistant }) {
  const { activeTrip, toggleActivityDone } = useTrips()
  const [weather, setWeather] = useState(null)
  const [selectedDayId, setSelectedDayId] = useState(null)
  const today = new Date().toLocaleDateString('en-CA', { timeZone:activeTrip.timezone || 'America/Santiago' })
  const selection = useMemo(() => {
    const manuallySelected = activeTrip.days.find(day => day.id === selectedDayId)
    if (manuallySelected) return { day:manuallySelected, label:manuallySelected.date === today ? 'HOY' : `DÍA ${manuallySelected.position} · ${formatDate(manuallySelected.date)}` }
    const exact = activeTrip.days.find(day => day.date === today)
    if (exact) return { day:exact, label:'HOY' }
    const future = activeTrip.days.filter(day => day.date && day.date > today).sort((a, b) => a.date.localeCompare(b.date))[0]
    if (future) return { day:future, label:`PRÓXIMO DÍA · ${formatDate(future.date)}` }
    return activeTrip.days[0] ? { day:activeTrip.days[0], label:'PRIMER DÍA' } : null
  }, [activeTrip.days, selectedDayId, today])

  useEffect(() => {
    let alive = true
    setWeather(null)
    if (!selection?.day.city || !selection.day.date) return () => { alive = false }
    geocodeCity(selection.day.city)
      .then(point => point && getWeather(point.lat, point.lon, selection.day.date))
      .then(result => { if (alive) setWeather(result) })
      .catch(() => {})
    return () => { alive = false }
  }, [selection])

  if (!selection) return (
    <div className="empty-panel workspace-empty">
      <div className="empty-icon">◇</div><h2>Aún no hay días</h2>
      <p>Agrega días a la ruta o pídele al asistente que prepare el itinerario.</p>
      <button className="primary-btn compact" onClick={onOpenAssistant}>Abrir asistente</button>
    </div>
  )

  const { day, label } = selection
  const dayIndex = activeTrip.days.findIndex(item => item.id === day.id)
  const isToday = day.date === today
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone:activeTrip.timezone || 'America/Santiago',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).format(new Date())
  const timed = day.activities.filter(activity => activity.time)
  const currentActivityId = isToday
    ? [...timed].reverse().find(activity => activity.time <= currentTime)?.id
    : null
  const doneCount = day.activities.filter(activity => activity.done).length
  const hotel = activeTrip.hotels.find(item => item.city.toLowerCase() === day.city.toLowerCase() || (day.date && item.checkIn <= day.date && (!item.checkOut || item.checkOut >= day.date)))

  return (
    <section>
      <div className="today-hero">
        <div className="day-nav">
          <button disabled={dayIndex <= 0} onClick={() => setSelectedDayId(activeTrip.days[dayIndex - 1]?.id)}>←</button>
          {!isToday && activeTrip.days.some(item => item.date === today) && <button onClick={() => setSelectedDayId(activeTrip.days.find(item => item.date === today)?.id)}>Volver a hoy</button>}
          <button disabled={dayIndex >= activeTrip.days.length - 1} onClick={() => setSelectedDayId(activeTrip.days[dayIndex + 1]?.id)}>→</button>
        </div>
        <small>{label}</small><h2>{day.city}</h2><p>{day.title}</p>
        <b className="done-count">{doneCount} de {day.activities.length} panoramas hechos</b>
        {weather && <span className="weather-chip">↑{weather.max}º ↓{weather.min}º · {weather.rain}% lluvia</span>}
        {day.activities.length > 0 && (
          <button className="replan-btn" onClick={() => onOpenAssistant(
            `Quiero replanificar el día ${day.position || day.day} en ${day.city} (day_id ${day.id}). Plan actual: ${day.activities.map(item => `${item.time || 'sin hora'} ${item.name} (activity_id ${item.id})`).join('; ')}. Propón mejoras o reemplazos considerando el clima y espera mi confirmación antes de cambiar nada.`
          )}>✦ Replanificar este día</button>
        )}
      </div>
      <div className="timeline">
        {day.activities.length === 0 && <p className="muted-copy">Este día todavía no tiene panoramas.</p>}
        {day.activities.map(activity => <div className={`timeline-item ${isToday && activity.time && activity.time < currentTime ? 'past' : ''} ${activity.id === currentActivityId ? 'current' : ''} ${activity.done ? 'done' : ''}`} key={activity.id}>
          <button className="done-toggle" onClick={() => toggleActivityDone(day.id, activity.id)} aria-label={activity.done ? 'Marcar pendiente' : 'Marcar hecho'}>{activity.done ? '✓' : ''}</button>
          <b>{activity.time || '--:--'}</b><span /><div><h3>{activity.name}</h3>{activity.address && <p>{activity.address}</p>}</div>
          {mapsUrl(activity) && <a className="maps-link" href={mapsUrl(activity)} target="_blank" rel="noreferrer" aria-label={`Cómo llegar a ${activity.name}`}>↗</a>}
        </div>)}
      </div>
      {hotel && <div className="hotel-callout"><small>ALOJAMIENTO</small><h3>{hotel.name}</h3><p>{hotel.address || hotel.city}</p>{mapsUrl(hotel) && <a href={mapsUrl(hotel)} target="_blank" rel="noreferrer">Cómo llegar ↗</a>}</div>}
    </section>
  )
}
