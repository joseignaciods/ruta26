import { distanceKm, geocodeCity } from './geo.js'

const located = item => item?.latitude != null && item?.longitude != null

export function dayHotel(day, hotels = []) {
  return hotels.find(hotel =>
    hotel.city?.toLowerCase() === day.city?.toLowerCase() ||
    (day.date && hotel.checkIn && hotel.checkIn <= day.date && (!hotel.checkOut || hotel.checkOut >= day.date))
  ) || null
}

const samePlace = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase()

// Viewbox "lonMin,latMax,lonMax,latMin" (con margen) que envuelve puntos ya
// ubicados, para SESGAR el geocoding de un nombre ambiguo hacia la región real
// del viaje ("Williams" → Arizona, no Iowa). null si no hay puntos.
export function boundsViewbox(items, pad = 1.5) {
  const points = (items || []).filter(located)
  if (!points.length) return null
  const lats = points.map(item => item.latitude)
  const lons = points.map(item => item.longitude)
  return `${(Math.min(...lons) - pad).toFixed(2)},${(Math.max(...lats) + pad).toFixed(2)},${(Math.max(...lons) + pad).toFixed(2)},${(Math.min(...lats) - pad).toFixed(2)}`
}

// Punto de referencia del día para buscar lugares cercanos. CLAVE para roadtrips:
// el día puede estar en un lugar distinto al hotel (ej. paso por Valley of Fire
// pero el hotel sigue en Las Vegas). Por eso la CIUDAD/LUGAR del día manda; el
// hotel solo se usa de ancla si está en el mismo lugar (ahí da coords exactas).
export async function dayAnchor(day, hotels = []) {
  const hotel = dayHotel(day, hotels)
  // 1) Hotel del día, SOLO si está en la misma ciudad/lugar del día.
  if (located(hotel) && samePlace(hotel.city, day.city)) {
    return { latitude:hotel.latitude, longitude:hotel.longitude, label:hotel.name }
  }
  // 2) Ciudad/lugar del día. Se geocodifica sesgado a lo que el día/viaje ya
  // tiene ubicado (panoramas + hoteles) para no caer en un homónimo lejano.
  try {
    const viewbox = boundsViewbox([...(day.activities || []), ...(hotels || [])])
    const point = await geocodeCity(day.city, viewbox ? { viewbox } : undefined)
    if (point) return { latitude:point.lat, longitude:point.lon, label:`el centro de ${day.city}` }
  } catch { /* seguimos con los fallbacks */ }
  // 3) Primer panorama ya ubicado del día.
  const activity = (day.activities || []).find(located)
  if (activity) return { latitude:activity.latitude, longitude:activity.longitude, label:activity.name }
  // 4) Último recurso: el hotel aunque sea de otra ciudad.
  if (located(hotel)) return { latitude:hotel.latitude, longitude:hotel.longitude, label:hotel.name }
  return null
}

export function suggestNextTime(activities = []) {
  const timed = activities.filter(item => item.time).sort((a, b) => a.time.localeCompare(b.time))
  if (!timed.length) return '09:30'
  const last = timed[timed.length - 1]
  const [hours, minutes] = last.time.split(':').map(Number)
  if (Number.isNaN(hours)) return '09:30'
  const gap = last.category === 'food' ? 90 : 120
  const total = Math.min(hours * 60 + (minutes || 0) + gap, 21 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Para el chip "Comer": elige el próximo momento de comida libre del día
// (desayuno → almuerzo → cena). Si ya hay algo en todos, cae en suggestNextTime.
export function suggestMealTime(activities = []) {
  const meals = [
    { time:'09:00', from:5 * 60, to:11 * 60 },
    { time:'13:30', from:11 * 60, to:16 * 60 },
    { time:'20:30', from:18 * 60, to:23 * 60 }
  ]
  const toMinutes = value => {
    const [hours, minutes] = (value || '').split(':').map(Number)
    return Number.isFinite(hours) ? hours * 60 + (minutes || 0) : null
  }
  const taken = activities
    .filter(item => item.category === 'food')
    .map(item => toMinutes(item.time))
    .filter(value => value != null)
  for (const meal of meals) {
    if (!taken.some(value => value >= meal.from && value < meal.to)) return meal.time
  }
  return suggestNextTime(activities)
}

export function formatDate(iso) {
  if (!iso) return ''
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  const value = new Intl.DateTimeFormat('es-CL', {
    weekday:'short',
    day:'numeric',
    month:'short'
  }).format(date)
  return value.replace(/\./g, '').replace(/^./, letter => letter.toUpperCase())
}

export function addDays(iso, amount) {
  if (!iso) return ''
  const date = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

// --- Inteligencia del día: cuánto dura, cuánto traslado, qué tan cargado --------
// Todo a partir de datos que ya tenemos (categoría + coordenadas). Sin APIs.

// Duración media por tipo cuando el panorama no trae una explícita.
const CATEGORY_MINUTES = { culture: 90, food: 75, nature: 120, entertainment: 105, transport: 30 }

// "2h", "1h30", "1.5h", "90 min", "45m", "2" → minutos. null si no se entiende.
export function durationToMinutes(text) {
  const value = String(text || '').toLowerCase().replace(',', '.').trim()
  if (!value) return null
  const hours = value.match(/(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2}))?/)
  if (hours) return Math.round(parseFloat(hours[1]) * 60) + (hours[2] ? Number(hours[2]) : 0)
  const minutes = value.match(/(\d+)\s*m(?:in)?/)
  if (minutes) return Number(minutes[1])
  const bare = value.match(/^(\d+(?:\.\d+)?)$/)
  if (bare) { const n = parseFloat(bare[1]); return n <= 8 ? Math.round(n * 60) : Math.round(n) }
  return null
}

export const activityMinutes = activity =>
  durationToMinutes(activity?.duration) || CATEGORY_MINUTES[activity?.category] || 90

// Traslado estimado entre dos paradas ubicadas. Respaldo cuando no hay ruta real
// de ORS. A pie si están muy cerca; si no, en auto con una velocidad media que
// escala con la distancia (los hops cortos son urbanos y lentos; los tramos
// largos van por carretera/autopista y son mucho más rápidos), sobre la distancia
// por CARRETERA estimada (las rutas rodean, no son líneas rectas). Devuelve null
// si alguna parada no tiene coordenadas.
export function travelEstimate(from, to) {
  if (!located(from) || !located(to)) return null
  const straightKm = distanceKm([from.latitude, from.longitude], [to.latitude, to.longitude])
  if (straightKm <= 1.4) {
    return { km: straightKm, minutes: Math.max(3, Math.round((straightKm / 4.6) * 60)), mode: 'walk' }
  }
  const roadKm = straightKm * 1.3
  const speed = straightKm < 5 ? 25 : straightKm < 25 ? 55 : straightKm < 80 ? 78 : 85
  return { km: roadKm, minutes: Math.max(6, Math.round((roadKm / speed) * 60)), mode: 'ride' }
}

// Carga del día: tiempo en panoramas + traslados entre paradas consecutivas,
// con un nivel (light/good/full/over) para avisar cuando el día está apretado.
export function dayLoad(activities = []) {
  const list = activities || []
  const activeMinutes = list.reduce((sum, activity) => sum + activityMinutes(activity), 0)
  const stops = list.filter(located)
  let travelMinutes = 0
  for (let i = 1; i < stops.length; i++) travelMinutes += travelEstimate(stops[i - 1], stops[i])?.minutes || 0
  const totalMinutes = activeMinutes + travelMinutes
  const level = totalMinutes >= 600 ? 'over' : totalMinutes >= 480 ? 'full' : totalMinutes >= 180 ? 'good' : 'light'
  return { count: list.length, activeMinutes, travelMinutes, totalMinutes, level }
}

export function formatMinutes(minutes) {
  if (!minutes || minutes < 1) return ''
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`
}

export const formatKm = km =>
  km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`

// ¿El día ya tiene una comida? (para el aviso "falta dónde comer" del picker).
export const hasMeal = (activities = []) => (activities || []).some(activity => activity.category === 'food')
