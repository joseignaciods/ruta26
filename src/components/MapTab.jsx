import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { distanceKm, geocodeCity, geocodeQuery } from '../lib/geo.js'
import { dayAnchor } from '../lib/planner.js'
import { fetchRoute, formatDuration } from '../lib/routing.js'
import { useTrips } from '../state/TripContext.jsx'
import CategoryIcon, { categories, categoryFor, pinHtml, hotelPinHtml } from './CategoryIcon.jsx'

const hasCoords = item => item.latitude != null && item.longitude != null
const mapsUrl = item => `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`
const dayColors = ['#8b5cf6', '#0ea5a8', '#f59e0b', '#c44e92', '#2563eb', '#16a34a']

const avgCoords = items => {
  const located = (items || []).filter(hasCoords)
  if (!located.length) return null
  return [
    located.reduce((sum, item) => sum + item.latitude, 0) / located.length,
    located.reduce((sum, item) => sum + item.longitude, 0) / located.length
  ]
}

// Coordenada de un día SIN geocodificar su nombre (que es ambiguo: "Williams"
// cae en Iowa). Usa lo que ya tenemos exacto: promedio de panoramas ubicados →
// hotel de esa misma ciudad → parada/destino guardado. null si no hay ninguna
// pista y toca geocodificar (ahí se sesga con el viewbox del viaje).
const knownDayPoint = (day, dayStops = [], hotels = []) => {
  const fromActivities = avgCoords(day.activities)
  if (fromActivities) return fromActivities
  const hotel = (hotels || []).find(item => hasCoords(item) && item.city?.trim().toLowerCase() === day.city?.trim().toLowerCase())
  if (hotel) return [hotel.latitude, hotel.longitude]
  const stop = (dayStops || []).find(item => item.latitude != null && item.longitude != null)
  if (stop) return [stop.latitude, stop.longitude]
  return null
}

// Caja envolvente (con margen) de todo lo que el viaje tiene ubicado, para sesgar
// el geocoding de nombres ambiguos hacia la región real del viaje.
const tripViewbox = trip => {
  const points = []
  for (const day of trip.days) {
    ;(day.activities || []).forEach(item => { if (hasCoords(item)) points.push([item.latitude, item.longitude]) })
    ;(trip.preferences?.dayStops?.[day.id] || []).forEach(item => { if (item.latitude != null && item.longitude != null) points.push([item.latitude, item.longitude]) })
  }
  ;(trip.hotels || []).forEach(item => { if (hasCoords(item)) points.push([item.latitude, item.longitude]) })
  if (!points.length) return null
  const lats = points.map(point => point[0])
  const lons = points.map(point => point[1])
  const pad = 1.2
  // Nominatim viewbox: lonMin,latMax,lonMax,latMin
  return `${(Math.min(...lons) - pad).toFixed(2)},${(Math.max(...lats) + pad).toFixed(2)},${(Math.max(...lons) + pad).toFixed(2)},${(Math.min(...lats) - pad).toFixed(2)}`
}

// Marcador de un punto de la ruta del día: origen (Salida), destino (Llegada) o
// una parada de paso numerada. Se dibuja aparte de los pines de panorama.
const routeWaypointIcon = (kind, label) => L.divIcon({
  className:'route-wp-wrap',
  html:`<span class="route-wp ${kind}">${label}</span>`,
  iconSize:[26, 26],
  iconAnchor:[13, 13]
})
const clusterActivities = activities => {
  const clusters = []
  for (const activity of activities.filter(hasCoords)) {
    const point = [activity.latitude, activity.longitude]
    let cluster = clusters.find(item => distanceKm(item.center, point) <= 1.8)
    if (!cluster) {
      cluster = { activities:[], center:point }
      clusters.push(cluster)
    }
    cluster.activities.push(activity)
    cluster.center = [
      cluster.activities.reduce((sum, item) => sum + item.latitude, 0) / cluster.activities.length,
      cluster.activities.reduce((sum, item) => sum + item.longitude, 0) / cluster.activities.length
    ]
  }
  return clusters
}

export default function MapTab() {
  const { activeTrip, updateActivity, searchPlaces } = useTrips()
  const elementRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)       // capa de marcadores/rutas (se intercambia)
  const renderSeqRef = useRef(0)      // guarda para descartar redibujos viejos
  const fitSigRef = useRef('')        // último encuadre aplicado (para preservar zoom)
  const lastPointsRef = useRef([])    // puntos vigentes (para el botón recentrar)
  const [empty, setEmpty] = useState(false)
  const [routeInfo, setRouteInfo] = useState(null)
  const [selectedDayId, setSelectedDayId] = useState('all')
  const [locatingId, setLocatingId] = useState(null)
  const [searchingId, setSearchingId] = useState(null)
  const [locationQuery, setLocationQuery] = useState('')
  const [locationResults, setLocationResults] = useState([])
  const [locationBusy, setLocationBusy] = useState(false)
  const selectedDay = activeTrip.days.find(day => day.id === selectedDayId)
  const tripCities = new Set(activeTrip.days.map(day => day.city?.trim().toLowerCase()).filter(Boolean))
  const isSingleCityTrip = tripCities.size === 1

  // El mapa Leaflet se crea UNA sola vez y persiste. Antes se destruía y recreaba
  // en cada cambio de día o sync de realtime (flash + tiles recargando + zoom
  // perdido); ahora solo se intercambian los marcadores en una capa (ver abajo).
  useEffect(() => {
    if (!elementRef.current) return
    const map = L.map(elementRef.current)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map)
    map.setView([20, 0], 2)
    // El contenedor puede montar con tamaño provisional; recalcular al pintar.
    const sizer = setTimeout(() => map.invalidateSize(), 60)
    return () => { clearTimeout(sizer); map.remove(); mapRef.current = null; layerRef.current = null }
  }, [])

  // Redibuja marcadores/rutas en una capa NUEVA y la intercambia por la vigente
  // (doble buffer: sin parpadeo). Preserva el zoom/paneo del usuario salvo que
  // cambie el contenido (otro día u otro conjunto de puntos).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const seq = ++renderSeqRef.current
    const alive = () => seq === renderSeqRef.current

    const draw = async () => {
      const group = L.layerGroup()
      const points = []
      const route = []
      let routeDrawn = false
      setRouteInfo(null)
      const viewbox = tripViewbox(activeTrip)
      const visibleDays = selectedDay ? [selectedDay] : activeTrip.days
      const dayActivityCoords = selectedDay ? selectedDay.activities.filter(hasCoords) : []

      if (!selectedDay && isSingleCityTrip) {
        activeTrip.days.forEach((day, dayIndex) => {
          const color = dayColors[dayIndex % dayColors.length]
          const located = day.activities.filter(hasCoords)
          points.push(...located.map(activity => [activity.latitude, activity.longitude]))
          located.forEach(activity => {
            const dot = L.divIcon({ className:'overview-poi-dot', html:`<i style="--day-color:${color}"></i>`, iconSize:[12, 12], iconAnchor:[6, 6] })
            L.marker([activity.latitude, activity.longitude], { icon:dot }).bindTooltip(activity.name, { direction:'top' }).addTo(group)
          })
          clusterActivities(day.activities).forEach(cluster => {
            const icon = L.divIcon({ className:'overview-cluster-marker', html:`<span style="--day-color:${color}">D${day.position}<b>${cluster.activities.length}</b></span>`, iconSize:[52, 30], iconAnchor:[26, 15] })
            const names = cluster.activities.map(activity => activity.name).join('<br>')
            L.marker(cluster.center, { icon, zIndexOffset:500 })
              .bindPopup(`<b>Día ${day.position} · ${cluster.activities.length} ${cluster.activities.length === 1 ? 'lugar' : 'lugares'}</b><br>${names}`)
              .on('click', () => setSelectedDayId(day.id))
              .addTo(group)
          })
        })
      }

      if (!selectedDay && !isSingleCityTrip) {
        const cityGroups = []
        for (const day of activeTrip.days) {
          const key = day.city?.trim().toLowerCase()
          let cg = cityGroups.find(item => item.key === key)
          if (!cg) { cg = { key, city:day.city, days:[] }; cityGroups.push(cg) }
          cg.days.push(day)
        }
        for (const cg of cityGroups) {
          try {
            // Coords exactas que ya tenemos (panoramas/destino/hotel) antes de
            // geocodificar el nombre; si toca geocodificar, sesgado a la región.
            const known = cg.days.map(day => knownDayPoint(day, activeTrip.preferences?.dayStops?.[day.id], activeTrip.hotels)).find(Boolean)
            const point = known ? { lat:known[0], lon:known[1] } : await geocodeCity(cg.city, { viewbox })
            if (!alive() || !point) continue
            const latLng = [point.lat, point.lon]
            points.push(latLng)
            route.push(latLng)
            const dayLabel = cg.days.length === 1 ? `D${cg.days[0].position}` : `${cg.days.length}d`
            const icon = L.divIcon({ className:'day-map-icon', html:`<span>${dayLabel}</span>`, iconSize:[34, 34], iconAnchor:[17, 17] })
            const daysHtml = cg.days.map(day => `Día ${day.position}: ${day.title}`).join('<br>')
            const marker = L.marker(latLng, { icon }).bindPopup(`<b>${cg.city}</b><br>${daysHtml}`).addTo(group)
            // Tocar una ciudad de un solo día salta directo a ese día.
            if (cg.days.length === 1) marker.on('click', () => setSelectedDayId(cg.days[0].id))
          } catch {
            // Una ciudad sin resultado no impide mostrar el resto del viaje.
          }
        }
      } else if (selectedDay && dayActivityCoords.length === 0) {
        try {
          const known = knownDayPoint(selectedDay, activeTrip.preferences?.dayStops?.[selectedDay.id], activeTrip.hotels)
          const point = known ? { lat:known[0], lon:known[1] } : await geocodeCity(selectedDay.city, { viewbox })
          if (alive() && point) {
            const latLng = [point.lat, point.lon]
            points.push(latLng)
            const icon = L.divIcon({ className:'day-map-icon', html:`<span>${selectedDay.position}</span>`, iconSize:[34, 34], iconAnchor:[17, 17] })
            L.marker(latLng, { icon }).bindPopup(`<b>${selectedDay.title}</b><br>${selectedDay.city}`).addTo(group)
          }
        } catch {
          // Una ciudad sin resultado no impide mostrar el resto del viaje.
        }
      }

      if (selectedDay) {
        for (const day of visibleDays) {
          for (const [activityIndex, activity] of day.activities.entries()) {
            if (!hasCoords(activity)) continue
            const latLng = [activity.latitude, activity.longitude]
            points.push(latLng)
            route.push(latLng)
            const category = categoryFor(activity.category)
            const icon = L.divIcon({ className:'poi-pin-wrap', html:pinHtml(category.id, activityIndex + 1), iconSize:[32, 32], iconAnchor:[16, 16] })
            L.marker(latLng, { icon })
              .bindPopup(`<b>${activityIndex + 1}. ${activity.name}</b><br>${[activity.time, category.label].filter(Boolean).join(' · ')}${activity.address ? `<br>${activity.address}` : ''}<br><a href="${mapsUrl(activity)}" target="_blank" rel="noreferrer">Cómo llegar ↗</a>`)
              .addTo(group)
          }
        }
      }

      // Ruta real de manejo del día (roadtrip): origen → paradas → destino con la
      // geometría de OpenRouteService, en lugar de una recta entre panoramas.
      if (selectedDay) {
        const dayStops = activeTrip.preferences?.dayStops?.[selectedDay.id] || []
        const routeStops = dayStops.filter(stop => stop.kind !== 'destination' && hasCoords(stop))
        const destination = dayStops.find(stop => stop.kind === 'destination' && hasCoords(stop))
        if (routeStops.length || destination) {
          const origin = await dayAnchor(selectedDay, activeTrip.hotels)
          if (!alive()) return
          const waypoints = [origin, ...routeStops, ...(destination ? [destination] : [])].filter(hasCoords)
          if (waypoints.length >= 2) {
            waypoints.forEach((waypoint, index) => {
              const isOrigin = index === 0
              const isDest = Boolean(destination) && index === waypoints.length - 1
              const kind = isOrigin ? 'origin' : isDest ? 'dest' : 'stop'
              const label = isOrigin ? 'A' : isDest ? 'B' : String(index)
              const role = isOrigin ? 'Salida' : isDest ? 'Llegada' : `Parada ${index}`
              const latLng = [waypoint.latitude, waypoint.longitude]
              points.push(latLng)
              L.marker(latLng, { icon:routeWaypointIcon(kind, label), zIndexOffset:400 })
                .bindPopup(`<b>${role}</b><br>${waypoint.label || waypoint.name || ''}`)
                .addTo(group)
            })
            const routeGeo = await fetchRoute(waypoints)
            if (!alive()) return
            if (routeGeo?.geometry?.length > 1) {
              L.polyline(routeGeo.geometry, { color:'#7042ce', weight:5, opacity:.85 }).addTo(group)
              routeGeo.geometry.forEach(point => points.push(point))
              routeDrawn = true
              setRouteInfo({ distanceKm:routeGeo.distanceKm, durationMin:routeGeo.durationMin, stops:routeStops.length })
            } else {
              // ORS no disponible → recta punteada entre los puntos, como respaldo.
              L.polyline(waypoints.map(waypoint => [waypoint.latitude, waypoint.longitude]), { color:'#7042ce', weight:3, dashArray:'6 6', opacity:.7 }).addTo(group)
              routeDrawn = true
            }
          }
        }
      }

      const visibleHotels = selectedDay
        ? activeTrip.hotels.filter(hotel =>
            hotel.city.toLowerCase() === selectedDay.city.toLowerCase() ||
            (selectedDay.date && hotel.checkIn && hotel.checkIn <= selectedDay.date && (!hotel.checkOut || hotel.checkOut >= selectedDay.date))
          )
        : []
      for (const hotel of visibleHotels) {
        if (!hasCoords(hotel)) continue
        const latLng = [hotel.latitude, hotel.longitude]
        points.push(latLng)
        const icon = L.divIcon({ className:'poi-pin-wrap', html:hotelPinHtml(), iconSize:[32, 32], iconAnchor:[16, 16] })
        L.marker(latLng, { icon }).bindPopup(`<b>${hotel.name}</b><br>${hotel.address || hotel.city}<br><a href="${mapsUrl(hotel)}" target="_blank" rel="noreferrer">Cómo llegar ↗</a>`).addTo(group)
      }

      if (route.length > 1 && !routeDrawn) {
        L.polyline(route, { color:'#8b5cf6', weight:3, dashArray:selectedDay ? undefined : '7 7', opacity:.8 }).addTo(group)
      }

      if (!alive()) return
      // Intercambiar la capa vieja por la nueva (sin recargar el mapa base).
      if (layerRef.current) layerRef.current.remove()
      group.addTo(map)
      layerRef.current = group
      lastPointsRef.current = points

      if (points.length) {
        setEmpty(false)
        // Re-encuadrar SOLO si cambió el contenido; si es el mismo, conservar el
        // zoom/paneo que el usuario haya hecho a mano.
        const sig = selectedDayId + '|' + points.map(point => `${point[0].toFixed(3)},${point[1].toFixed(3)}`).join(';')
        if (sig !== fitSigRef.current) {
          fitSigRef.current = sig
          map.fitBounds(points, { padding:[28, 28], maxZoom:selectedDay || isSingleCityTrip ? 15 : 13 })
        }
      } else {
        fitSigRef.current = ''
        setEmpty(true)
      }
    }
    draw()
  }, [activeTrip, isSingleCityTrip, selectedDay, selectedDayId])

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

  // Navegación de días desde el propio mapa (sin subir a las tabs).
  const dayIndex = selectedDay ? activeTrip.days.findIndex(day => day.id === selectedDay.id) : -1
  const goToDay = delta => {
    const target = activeTrip.days[dayIndex + delta]
    if (target) setSelectedDayId(target.id)
  }
  const recenter = () => {
    const map = mapRef.current
    if (map && lastPointsRef.current.length) {
      map.fitBounds(lastPointsRef.current, { padding:[28, 28], maxZoom:selectedDay || isSingleCityTrip ? 15 : 13 })
    }
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
      {routeInfo && (routeInfo.distanceKm != null || routeInfo.durationMin != null) && (
        <div className="route-info-chip">
          <span className="route-info-line" />
          <b>Ruta del día</b>
          {routeInfo.distanceKm != null && <span>{Math.round(routeInfo.distanceKm)} km</span>}
          {routeInfo.durationMin != null && <span>{formatDuration(routeInfo.durationMin)} en auto</span>}
          {routeInfo.stops > 0 && <span>{routeInfo.stops} {routeInfo.stops === 1 ? 'parada de paso' : 'paradas de paso'}</span>}
        </div>
      )}
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
      <div className="map-canvas">
        <div ref={elementRef} className="map-container" />
        {selectedDay && activeTrip.days.length > 1 && (
          <div className="map-day-flip">
            <button type="button" onClick={() => goToDay(-1)} disabled={dayIndex <= 0} aria-label="Día anterior">‹</button>
            <span>Día {selectedDay.position}</span>
            <button type="button" onClick={() => goToDay(1)} disabled={dayIndex >= activeTrip.days.length - 1} aria-label="Día siguiente">›</button>
          </div>
        )}
        <button type="button" className="map-fab" onClick={recenter} aria-label="Centrar el mapa">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></svg>
        </button>
      </div>
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
