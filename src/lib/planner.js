import { geocodeCity } from './geo.js'

const located = item => item?.latitude != null && item?.longitude != null

export function dayHotel(day, hotels = []) {
  return hotels.find(hotel =>
    hotel.city?.toLowerCase() === day.city?.toLowerCase() ||
    (day.date && hotel.checkIn && hotel.checkIn <= day.date && (!hotel.checkOut || hotel.checkOut >= day.date))
  ) || null
}

// Punto de referencia del día para buscar lugares cercanos: hotel, primer
// panorama ubicado o, como último recurso, el centro geocodificado de la ciudad.
export async function dayAnchor(day, hotels = []) {
  const hotel = dayHotel(day, hotels)
  if (located(hotel)) return { latitude:hotel.latitude, longitude:hotel.longitude, label:hotel.name }
  const activity = (day.activities || []).find(located)
  if (activity) return { latitude:activity.latitude, longitude:activity.longitude, label:activity.name }
  try {
    const point = await geocodeCity(day.city)
    if (point) return { latitude:point.lat, longitude:point.lon, label:`el centro de ${day.city}` }
  } catch { /* sin ancla igual se puede buscar por texto */ }
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
