import { useEffect, useMemo, useState } from 'react'
import { geocodeCity, getWeather } from '../lib/geo.js'
import { useTrips } from '../state/TripContext.jsx'

export default function TodayTab({ onOpenAssistant }) {
  const { activeTrip } = useTrips()
  const [weather, setWeather] = useState(null)
  const today = new Date().toLocaleDateString('en-CA', { timeZone:activeTrip.timezone || 'America/Santiago' })
  const selection = useMemo(() => {
    const exact = activeTrip.days.find(day => day.date === today)
    if (exact) return { day:exact, label:'HOY' }
    const future = activeTrip.days.filter(day => day.date && day.date > today).sort((a, b) => a.date.localeCompare(b.date))[0]
    if (future) return { day:future, label:`PRÓXIMO DÍA · ${future.date}` }
    return activeTrip.days[0] ? { day:activeTrip.days[0], label:'PRIMER DÍA' } : null
  }, [activeTrip.days, today])

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
  const hotel = activeTrip.hotels.find(item => item.city.toLowerCase() === day.city.toLowerCase() || (day.date && item.checkIn <= day.date && (!item.checkOut || item.checkOut >= day.date)))

  return (
    <section>
      <div className="today-hero">
        <small>{label}</small><h2>{day.city}</h2><p>{day.title}</p>
        {weather && <span className="weather-chip">↑{weather.max}º ↓{weather.min}º · {weather.rain}% lluvia</span>}
        {day.activities.length > 0 && (
          <button className="replan-btn" onClick={() => onOpenAssistant(
            `Quiero replanificar el día ${day.position || day.day} en ${day.city} (day_id ${day.id}). Plan actual: ${day.activities.map(item => `${item.time || 'sin hora'} ${item.name} (activity_id ${item.id})`).join('; ')}. Propón mejoras o reemplazos considerando el clima y espera mi confirmación antes de cambiar nada.`
          )}>✦ Replanificar este día</button>
        )}
      </div>
      <div className="timeline">
        {day.activities.length === 0 && <p className="muted-copy">Este día todavía no tiene panoramas.</p>}
        {day.activities.map(activity => <div className="timeline-item" key={activity.id}>
          <b>{activity.time || '--:--'}</b><span /><div><h3>{activity.name}</h3>{activity.address && <p>{activity.address}</p>}</div>
        </div>)}
      </div>
      {hotel && <div className="hotel-callout"><small>ALOJAMIENTO</small><h3>{hotel.name}</h3><p>{hotel.address || hotel.city}</p></div>}
    </section>
  )
}
