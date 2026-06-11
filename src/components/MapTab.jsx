import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geocodeCity, geocodeQuery } from '../lib/geo.js'
import { useTrips } from '../state/TripContext.jsx'
import CategoryIcon, { categories, categoryFor, pinHtml, hotelPinHtml } from './CategoryIcon.jsx'

const hasCoords = item => item.latitude != null && item.longitude != null
const mapsUrl = item => `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`
const dayColors = ['#8b5cf6', '#0ea5a8', '#f59e0b', '#c44e92', '#2563eb', '#16a34a']

export default function MapTab() {
  const { activeTrip, updateActivity, searchPlaces } = useTrips()
  const elementRef = useRef(null)
  const mapRef = useRef(null)
  const [empty, setEmpty] = useState(false)
  const [selectedDayId, setSelectedDayId] = useState('all')
  const [locatingId, setLocatingId] = useState(null)
  const [searchingId, setSearchingId] = useState(null)
  const [locationQuery, setLocationQuery] = useState('')
  const [locationResults, setLocationResults] = useState([])
  const [locationBusy, setLocationBusy] = useState(false)
  const selectedDay = activeTrip.days.find(day => day.id === selectedDayId)
  const tripCities = new Set(activeTrip.days.map(day => day.city?.trim().toLowerCase()).filter(Boolean))
  const isSingleCityTrip = tripCities.size === 1

  useEffect(() => {
    if (!elementRef.current) return
    let alive = true
    const map = L.map(elementRef.current)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map)

    const render = async () => {
      const points = []
      const route = []
      const visibleDays = selectedDay ? [selectedDay] : activeTrip.days
      const dayActivityCoords = selectedDay ? selectedDay.activities.filter(hasCoords) : []

      if (!selectedDay && isSingleCityTrip) {
        const overviewDays = activeTrip.days.map((day, dayIndex) => ({
          day,
          dayIndex,
          route:day.activities
            .filter(hasCoords)
            .map(activity => [activity.latitude, activity.longitude])
        }))
        const renderOrder = [...overviewDays.slice(1), ...overviewDays.slice(0, 1)]

        renderOrder.forEach(({ day, dayIndex, route:dayRoute }) => {
          if (!dayRoute.length) return
          points.push(...dayRoute)
          const color = dayColors[dayIndex % dayColors.length]
          const isFeatured = dayIndex === 0
          if (dayRoute.length > 1) {
            const line = L.polyline(dayRoute, {
              color,
              weight:isFeatured ? 5 : 3,
              opacity:isFeatured ? .95 : .45,
              dashArray:isFeatured ? undefined : `${7 + dayIndex * 2} 7`
            }).addTo(map)
            line.bindTooltip(`Día ${day.position} · ${day.activities.length} ${day.activities.length === 1 ? 'panorama' : 'panoramas'}`, { sticky:true })
            line.on('click', () => setSelectedDayId(day.id))
          }

          const icon = L.divIcon({
            className:'overview-day-marker',
            html:`<span style="--day-color:${color}">D${day.position}</span>`,
            iconSize:[34, 30],
            iconAnchor:[17, 15]
          })
          L.marker(dayRoute[0], { icon })
            .bindPopup(`<b>Día ${day.position}</b><br>${day.activities.length} ${day.activities.length === 1 ? 'panorama' : 'panoramas'}`)
            .on('click', () => setSelectedDayId(day.id))
            .addTo(map)
        })
      }

      // En viajes entre ciudades se mantiene el resumen geográfico por jornada.
      if ((!selectedDay && !isSingleCityTrip) || (selectedDay && dayActivityCoords.length === 0)) {
        for (const day of visibleDays) {
          try {
            const point = await geocodeCity(day.city)
            if (!alive || !point) continue
            const latLng = [point.lat, point.lon]
            points.push(latLng)
            if (!selectedDay) route.push(latLng)
            const dayNumber = day.position || day.day
            const icon = L.divIcon({ className:'day-map-icon', html:`<span>${dayNumber}</span>`, iconSize:[34, 34], iconAnchor:[17, 17] })
            L.marker(latLng, { icon }).bindPopup(`<b>${day.title}</b><br>${day.city}`).addTo(map)
          } catch {
            // Una ciudad sin resultado no impide mostrar el resto del viaje.
          }
        }
      }

      if (selectedDay || !isSingleCityTrip) {
        for (const day of visibleDays) {
          for (const [activityIndex, activity] of day.activities.entries()) {
            if (!hasCoords(activity)) continue
            const latLng = [activity.latitude, activity.longitude]
            points.push(latLng)
            if (selectedDay) route.push(latLng)
            const category = categoryFor(activity.category)
            const icon = L.divIcon({ className:'poi-pin-wrap', html:pinHtml(category.id, activityIndex + 1), iconSize:[32, 32], iconAnchor:[16, 16] })
            L.marker(latLng, { icon })
              .bindPopup(`<b>${activityIndex + 1}. ${activity.name}</b><br>${[activity.time, category.label].filter(Boolean).join(' · ')}${activity.address ? `<br>${activity.address}` : ''}<br><a href="${mapsUrl(activity)}" target="_blank" rel="noreferrer">Cómo llegar ↗</a>`)
              .addTo(map)
          }
        }
      }

      const visibleHotels = selectedDay
        ? activeTrip.hotels.filter(hotel =>
            hotel.city.toLowerCase() === selectedDay.city.toLowerCase() ||
            (selectedDay.date && hotel.checkIn <= selectedDay.date && (!hotel.checkOut || hotel.checkOut >= selectedDay.date))
          )
        : isSingleCityTrip ? [] : activeTrip.hotels
      for (const hotel of visibleHotels) {
        if (!hasCoords(hotel)) continue
        const latLng = [hotel.latitude, hotel.longitude]
        points.push(latLng)
        const icon = L.divIcon({ className:'poi-pin-wrap', html:hotelPinHtml(), iconSize:[32, 32], iconAnchor:[16, 16] })
        L.marker(latLng, { icon }).bindPopup(`<b>${hotel.name}</b><br>${hotel.address || hotel.city}<br><a href="${mapsUrl(hotel)}" target="_blank" rel="noreferrer">Cómo llegar ↗</a>`).addTo(map)
      }

      if (!alive) return
      if (route.length > 1) {
        L.polyline(route, {
          color:'#8b5cf6',
          weight:3,
          dashArray:selectedDay ? undefined : '7 7',
          opacity:.8
        }).addTo(map)
      }
      if (points.length) {
        map.fitBounds(points, { padding:[28, 28], maxZoom:selectedDay || isSingleCityTrip ? 15 : 13 })
        setEmpty(false)
      } else {
        map.setView([-33.45, -70.66], 3)
        setEmpty(true)
      }
    }
    render()

    return () => {
      alive = false
      map.remove()
      mapRef.current = null
    }
  }, [activeTrip.days, activeTrip.hotels, isSingleCityTrip, selectedDay, selectedDayId])

  const locate = async activity => {
    if (!selectedDay || !activity.address) return
    setLocatingId(activity.id)
    try {
      const point = await geocodeQuery([activity.address, selectedDay.city].filter(Boolean).join(', '))
      if (point) await updateActivity(selectedDay.id, activity.id, { latitude:point.lat, longitude:point.lon })
    } catch {
      // Sin resultado: se mantiene en la lista de pendientes.
    } finally {
      setLocatingId(null)
    }
  }

  const searchLocation = async (event, activity) => {
    event.preventDefault()
    const query = locationQuery.trim()
    if (!selectedDay || query.length < 3) return
    setLocationBusy(true)
    const result = await searchPlaces(query, selectedDay.city, activity.category)
    setLocationResults(result?.places || [])
    setLocationBusy(false)
  }

  const chooseLocation = async (activity, place) => {
    await updateActivity(selectedDay.id, activity.id, {
      name:place.name || activity.name,
      address:place.address || '',
      latitude:place.latitude ?? null,
      longitude:place.longitude ?? null,
      tripadvisorLocationId:String(place.locationId || '').startsWith('local-') ? '' : place.locationId || ''
    })
    setSearchingId(null)
    setLocationQuery('')
    setLocationResults([])
  }

  const unlocated = selectedDay ? selectedDay.activities.filter(activity => !hasCoords(activity)) : []
  const legendCategories = selectedDay
    ? categories.filter(category => selectedDay.activities.some(activity => hasCoords(activity) && categoryFor(activity.category).id === category.id))
    : []

  return (
    <section className="map-section">
      <div className="section-heading">
        <div><h2>Mapa</h2><p>{selectedDay ? `Día ${selectedDay.position} · ${selectedDay.city}` : 'Ruta general del viaje'}</p></div>
      </div>
      <div className="map-view-selector">
        <button className={`map-overview-btn ${selectedDayId === 'all' ? 'active' : ''}`} onClick={() => setSelectedDayId('all')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m3 6 5-2 8 2 5-2v14l-5 2-8-2-5 2Z" />
            <path d="M8 4v14M16 6v14" />
          </svg>
          <span><b>Vista general</b><small>Ruta completa · {activeTrip.days.length} {activeTrip.days.length === 1 ? 'día' : 'días'}</small></span>
          <i>→</i>
        </button>
        <div className="map-days-heading"><span>DÍAS DEL VIAJE</span><small>Selecciona una jornada</small></div>
        <div className="map-day-tabs">
          {activeTrip.days.map((day, dayIndex) => (
            <button
              key={day.id}
              className={selectedDayId === day.id ? 'active' : ''}
              style={{ '--day-color':dayColors[dayIndex % dayColors.length] }}
              onClick={() => setSelectedDayId(day.id)}
            >
              <b>{day.position}</b>
              <span>{isSingleCityTrip ? `${day.activities.length} ${day.activities.length === 1 ? 'panorama' : 'panoramas'}` : day.city}</span>
              <small>{day.date ? day.date.slice(5).replace('-', '/') : 'Sin fecha'}</small>
            </button>
          ))}
        </div>
      </div>
      <div ref={elementRef} className="map-container" />
      {legendCategories.length > 0 && (
        <div className="map-legend">
          {legendCategories.map(category => (
            <span key={category.id} style={{ '--pin-color':category.color }}><CategoryIcon name={category.id} />{category.label}</span>
          ))}
        </div>
      )}
      {unlocated.length > 0 && (
        <div className="panel-card no-location-list">
          <h3>Sin ubicación en el mapa</h3>
          {unlocated.map(activity => (
            <div className="member-line" key={activity.id}>
              <span>{activity.name}<small>{activity.address || 'Agrega una dirección al panorama para ubicarlo'}</small></span>
              {activity.address ? (
                <button onClick={() => locate(activity)} disabled={locatingId === activity.id}>
                  {locatingId === activity.id ? 'Ubicando...' : 'Ubicar'}
                </button>
              ) : (
                <button onClick={() => {
                  setSearchingId(current => current === activity.id ? null : activity.id)
                  setLocationQuery(activity.name)
                  setLocationResults([])
                }}>Buscar ubicación</button>
              )}
              {searchingId === activity.id && (
                <form className="location-search" onSubmit={event => searchLocation(event, activity)}>
                  <input
                    autoFocus
                    minLength={3}
                    required
                    value={locationQuery}
                    onChange={event => setLocationQuery(event.target.value)}
                    placeholder={`Buscar en ${selectedDay.city}`}
                  />
                  <button disabled={locationBusy}>{locationBusy ? 'Buscando...' : 'Buscar'}</button>
                  {locationResults.length > 0 && (
                    <div className="location-results">
                      {locationResults.slice(0, 5).map(place => (
                        <button type="button" key={place.locationId || place.name} onClick={() => chooseLocation(activity, place)}>
                          <b>{place.name}</b>
                          <small>{place.address || selectedDay.city}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </form>
              )}
            </div>
          ))}
        </div>
      )}
      {empty && <p className="map-empty">{isSingleCityTrip ? 'Agrega ubicaciones a tus panoramas para ver los recorridos.' : 'Agrega días con ciudades para ver el mapa.'}</p>}
    </section>
  )
}
