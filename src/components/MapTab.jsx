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
      let routeDrawn = false
      setRouteInfo(null)
      const visibleDays = selectedDay ? [selectedDay] : activeTrip.days
      const dayActivityCoords = selectedDay ? selectedDay.activities.filter(hasCoords) : []

      if (!selectedDay && isSingleCityTrip) {
        activeTrip.days.forEach((day, dayIndex) => {
          const color = dayColors[dayIndex % dayColors.length]
          const located = day.activities.filter(hasCoords)
          points.push(...located.map(activity => [activity.latitude, activity.longitude]))
          located.forEach(activity => {
            const dot = L.divIcon({
              className:'overview-poi-dot',
              html:`<i style="--day-color:${color}"></i>`,
              iconSize:[12, 12],
              iconAnchor:[6, 6]
            })
            L.marker([activity.latitude, activity.longitude], { icon:dot })
              .bindTooltip(activity.name, { direction:'top' })
              .addTo(map)
          })

          clusterActivities(day.activities).forEach(cluster => {
            const icon = L.divIcon({
              className:'overview-cluster-marker',
              html:`<span style="--day-color:${color}">D${day.position}<b>${cluster.activities.length}</b></span>`,
              iconSize:[52, 30],
              iconAnchor:[26, 15]
            })
            const names = cluster.activities.map(activity => activity.name).join('<br>')
            L.marker(cluster.center, { icon, zIndexOffset:500 })
              .bindPopup(`<b>Día ${day.position} · ${cluster.activities.length} ${cluster.activities.length === 1 ? 'lugar' : 'lugares'}</b><br>${names}`)
              .on('click', () => setSelectedDayId(day.id))
              .addTo(map)
          })
        })
      }

      if (!selectedDay && !isSingleCityTrip) {
        const cityGroups = []
        for (const day of activeTrip.days) {
          const key = day.city?.trim().toLowerCase()
          let group = cityGroups.find(item => item.key === key)
          if (!group) {
            group = { key, city:day.city, days:[] }
            cityGroups.push(group)
          }
          group.days.push(day)
        }
        for (const group of cityGroups) {
          try {
            const point = await geocodeCity(group.city)
            if (!alive || !point) continue
            const latLng = [point.lat, point.lon]
            points.push(latLng)
            route.push(latLng)
            const dayLabel = group.days.length === 1 ? `D${group.days[0].position}` : `${group.days.length}d`
            const icon = L.divIcon({ className:'day-map-icon', html:`<span>${dayLabel}</span>`, iconSize:[34, 34], iconAnchor:[17, 17] })
            const days = group.days.map(day => `Día ${day.position}: ${day.title}`).join('<br>')
            L.marker(latLng, { icon }).bindPopup(`<b>${group.city}</b><br>${days}`).addTo(map)
          } catch {
            // Una ciudad sin resultado no impide mostrar el resto del viaje.
          }
        }
      } else if (selectedDay && dayActivityCoords.length === 0) {
        try {
          const point = await geocodeCity(selectedDay.city)
          if (alive && point) {
            const latLng = [point.lat, point.lon]
            points.push(latLng)
            const icon = L.divIcon({ className:'day-map-icon', html:`<span>${selectedDay.position}</span>`, iconSize:[34, 34], iconAnchor:[17, 17] })
            L.marker(latLng, { icon }).bindPopup(`<b>${selectedDay.title}</b><br>${selectedDay.city}`).addTo(map)
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
            if (selectedDay) route.push(latLng)
            const category = categoryFor(activity.category)
            const icon = L.divIcon({ className:'poi-pin-wrap', html:pinHtml(category.id, activityIndex + 1), iconSize:[32, 32], iconAnchor:[16, 16] })
            L.marker(latLng, { icon })
              .bindPopup(`<b>${activityIndex + 1}. ${activity.name}</b><br>${[activity.time, category.label].filter(Boolean).join(' · ')}${activity.address ? `<br>${activity.address}` : ''}<br><a href="${mapsUrl(activity)}" target="_blank" rel="noreferrer">Cómo llegar ↗</a>`)
              .addTo(map)
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
          if (!alive) return
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
                .addTo(map)
            })
            const routeGeo = await fetchRoute(waypoints)
            if (!alive) return
            if (routeGeo?.geometry?.length > 1) {
              L.polyline(routeGeo.geometry, { color:'#7042ce', weight:5, opacity:.85 }).addTo(map)
              routeGeo.geometry.forEach(point => points.push(point))
              routeDrawn = true
              setRouteInfo({ distanceKm:routeGeo.distanceKm, durationMin:routeGeo.durationMin, stops:routeStops.length })
            } else {
              // ORS no disponible → recta punteada entre los puntos, como respaldo.
              L.polyline(waypoints.map(waypoint => [waypoint.latitude, waypoint.longitude]), { color:'#7042ce', weight:3, dashArray:'6 6', opacity:.7 }).addTo(map)
              routeDrawn = true
            }
          }
        }
      }

      const visibleHotels = selectedDay
        ? activeTrip.hotels.filter(hotel =>
            hotel.city.toLowerCase() === selectedDay.city.toLowerCase() ||
            (selectedDay.date && hotel.checkIn <= selectedDay.date && (!hotel.checkOut || hotel.checkOut >= selectedDay.date))
          )
        : []
      for (const hotel of visibleHotels) {
        if (!hasCoords(hotel)) continue
        const latLng = [hotel.latitude, hotel.longitude]
        points.push(latLng)
        const icon = L.divIcon({ className:'poi-pin-wrap', html:hotelPinHtml(), iconSize:[32, 32], iconAnchor:[16, 16] })
        L.marker(latLng, { icon }).bindPopup(`<b>${hotel.name}</b><br>${hotel.address || hotel.city}<br><a href="${mapsUrl(hotel)}" target="_blank" rel="noreferrer">Cómo llegar ↗</a>`).addTo(map)
      }

      if (!alive) return
      if (route.length > 1 && !routeDrawn) {
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
  }, [activeTrip.days, activeTrip.hotels, activeTrip.preferences?.dayStops, isSingleCityTrip, selectedDay, selectedDayId])

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
