import { supabase } from './supabase.js'
import { distanceKm } from './geo.js'

// Geometría de ruta de manejo (origen → paradas → destino) vía la edge function
// route-directions, que consulta OpenRouteService con la key del servidor. Se
// cachea por waypoints en localStorage: la ruta entre puntos fijos no cambia, así
// no se gasta cuota de ORS cada vez que se re-dibuja el mapa.
export async function fetchRoute(waypoints = []) {
  const coordinates = (waypoints || [])
    .filter(point => point && point.latitude != null && point.longitude != null)
    .map(point => [Number(point.longitude), Number(point.latitude)])
  if (coordinates.length < 2) return null
  const cacheKey = 'ruta26_route_v2_' + coordinates.map(pair => pair.map(value => value.toFixed(4)).join(',')).join('|')
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
  } catch { /* localStorage no disponible */ }
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('route-directions', { body:{ coordinates } })
    if (error || !data || data.error || !Array.isArray(data.geometry) || data.geometry.length < 2) return null
    const result = { geometry:data.geometry, distanceKm:data.distanceKm, durationMin:data.durationMin, legs:Array.isArray(data.legs) ? data.legs : [] }
    try { localStorage.setItem(cacheKey, JSON.stringify(result)) } catch { /* storage lleno */ }
    return result
  } catch {
    return null
  }
}

// Enriquece la ruta [origen, ...paradas, destino] con puntos intermedios
// muestreados a lo largo de la geometría REAL de la carretera, para que el
// generador busque panoramas "de paso" en el trayecto y no solo en los extremos.
// Devuelve la lista ordenada (origen → vias → paradas → vias → destino) lista
// para mandar al generador: los puntos muestreados llevan role:'via' y sin
// nombre (solo aportan coords de búsqueda). Mantiene el orden de viaje para que
// el "leg" del generador siga siendo correcto.
export function buildRouteWithVias(geometry, waypoints, { everyKm = 40, maxVias = 6, skipNearKm = 10 } = {}) {
  if (!Array.isArray(geometry) || geometry.length < 2 || !Array.isArray(waypoints) || waypoints.length < 2) return waypoints
  // Índice de la geometría más cercano a cada waypoint (van en orden de viaje).
  const nearestIndex = point => {
    let best = 0
    let bestDistance = Infinity
    for (let i = 0; i < geometry.length; i++) {
      const distance = distanceKm(geometry[i], [point.latitude, point.longitude])
      if (distance < bestDistance) { bestDistance = distance; best = i }
    }
    return best
  }
  const indices = waypoints.map(nearestIndex)
  const result = []
  let vias = 0
  for (let w = 0; w < waypoints.length; w++) {
    result.push(waypoints[w])
    if (w === waypoints.length - 1) break
    let sinceLast = 0
    for (let i = indices[w] + 1; i < indices[w + 1] && vias < maxVias; i++) {
      sinceLast += distanceKm(geometry[i - 1], geometry[i])
      if (sinceLast < everyKm) continue
      sinceLast = 0
      const [latitude, longitude] = geometry[i]
      const tooClose = waypoints.some(point => distanceKm([latitude, longitude], [point.latitude, point.longitude]) < skipNearKm)
      if (!tooClose) { result.push({ name: '', latitude, longitude, role: 'via' }); vias++ }
    }
  }
  return result
}

// "3h 20min" / "45min" a partir de minutos (para el chip de la ruta).
export function formatDuration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return ''
  const total = Math.round(minutes)
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return hours ? `${hours}h${mins ? ` ${mins}min` : ''}` : `${mins}min`
}
