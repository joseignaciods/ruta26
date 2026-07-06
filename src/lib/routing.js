import { supabase } from './supabase.js'

// Geometría de ruta de manejo (origen → paradas → destino) vía la edge function
// route-directions, que consulta OpenRouteService con la key del servidor. Se
// cachea por waypoints en localStorage: la ruta entre puntos fijos no cambia, así
// no se gasta cuota de ORS cada vez que se re-dibuja el mapa.
export async function fetchRoute(waypoints = []) {
  const coordinates = (waypoints || [])
    .filter(point => point && point.latitude != null && point.longitude != null)
    .map(point => [Number(point.longitude), Number(point.latitude)])
  if (coordinates.length < 2) return null
  const cacheKey = 'ruta26_route_v1_' + coordinates.map(pair => pair.map(value => value.toFixed(4)).join(',')).join('|')
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
  } catch { /* localStorage no disponible */ }
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('route-directions', { body:{ coordinates } })
    if (error || !data || data.error || !Array.isArray(data.geometry) || data.geometry.length < 2) return null
    const result = { geometry:data.geometry, distanceKm:data.distanceKm, durationMin:data.durationMin }
    try { localStorage.setItem(cacheKey, JSON.stringify(result)) } catch { /* storage lleno */ }
    return result
  } catch {
    return null
  }
}

// "3h 20min" / "45min" a partir de minutos (para el chip de la ruta).
export function formatDuration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return ''
  const total = Math.round(minutes)
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return hours ? `${hours}h${mins ? ` ${mins}min` : ''}` : `${mins}min`
}
