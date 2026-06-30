const keyFor = query => `ruta26_geo_${query.trim().toLowerCase()}`
const nominatimEmail = import.meta.env.VITE_NOMINATIM_EMAIL || 'contacto@ruta26.app'

// Nominatim exige máximo 1 request por segundo; las peticiones se encolan.
let nextSlot = 0
const throttled = async fn => {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = now + wait + 1100
  if (wait) await new Promise(resolve => setTimeout(resolve, wait))
  return fn()
}

export async function geocodeQuery(query) {
  if (!query) return null
  const key = keyFor(query)
  const cached = localStorage.getItem(key)
  if (cached) return JSON.parse(cached)
  const params = new URLSearchParams({
    format:'json',
    limit:'1',
    'accept-language':'es',
    email:nominatimEmail,
    q:query
  })
  const response = await throttled(() => fetch(`https://nominatim.openstreetmap.org/search?${params}`))
  if (!response.ok) throw new Error('No se pudo geocodificar la ubicación')
  const [result] = await response.json()
  if (!result) return null
  const point = { lat:Number(result.lat), lon:Number(result.lon), label:result.display_name }
  localStorage.setItem(key, JSON.stringify(point))
  return point
}

export const geocodeCity = geocodeQuery

// Guarda en la caché de geocoding el punto exacto de un lugar elegido en el
// autocompletado, para que después `geocodeCity(day.city)` devuelva esas
// coordenadas en vez de re-geocodificar el nombre suelto (que es ambiguo:
// "Santiago" podría caer en Costa Rica). Falla en silencio si no hay storage.
export function rememberPlace(query, lat, lon, label) {
  if (!query || lat == null || lon == null) return
  try {
    localStorage.setItem(keyFor(query), JSON.stringify({ lat:Number(lat), lon:Number(lon), label:label || query }))
  } catch { /* localStorage lleno o no disponible */ }
}

// Geocoding inverso: nombre del lugar más cercano a un punto del mapa (para
// elegir paradas tocando el mapa). Usa photon como searchSpots.
export async function reverseSpot(lat, lon) {
  try {
    const params = new URLSearchParams({ lat:String(lat), lon:String(lon) })
    const response = await fetch(`https://photon.komoot.io/reverse?${params}`)
    if (!response.ok) return null
    const data = await response.json()
    const feature = (data.features || [])[0]
    const properties = feature?.properties || {}
    const name = properties.name || properties.city || properties.town || properties.village || properties.county || properties.state
    if (!name) return null
    const hint = [properties.city && properties.city !== name ? properties.city : '', properties.state, properties.country].filter(Boolean).join(', ')
    return { name, label:[name, hint].filter(Boolean).join(', '), hint, latitude:Number(lat), longitude:Number(lon) }
  } catch {
    return null
  }
}

export const distanceKm = (first, second) => {
  const toRadians = value => value * Math.PI / 180
  const latDistance = toRadians(second[0] - first[0])
  const lonDistance = toRadians(second[1] - first[1])
  const lat1 = toRadians(first[0])
  const lat2 = toRadians(second[0])
  const value = Math.sin(latDistance / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDistance / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export async function searchCities(query) {
  const clean = query?.trim()
  if (!clean || clean.length < 2) return []
  const key = `ruta26_city_search_v2_${clean.toLowerCase()}`
  const cached = localStorage.getItem(key)
  if (cached) return JSON.parse(cached)
  const params = new URLSearchParams({
    limit:'8',
    q:clean
  })
  const response = await fetch(`https://photon.komoot.io/api/?${params}`)
  if (!response.ok) throw new Error('No se pudieron buscar ciudades')
  const data = await response.json()
  const results = (data.features || [])
    .filter(feature => feature.properties?.type === 'city')
    .slice(0, 5)
    .map(feature => {
      const properties = feature.properties || {}
      const [longitude, latitude] = feature.geometry?.coordinates || []
      return {
        id:`${properties.osm_type || ''}-${properties.osm_id || properties.name}`,
        name:[properties.name, properties.state, properties.country].filter(Boolean).join(', '),
        city:properties.name,
        latitude:Number(latitude),
        longitude:Number(longitude)
      }
    })
  localStorage.setItem(key, JSON.stringify(results))
  return results
}

// Como searchCities pero para el día de un viaje: incluye cualquier lugar del
// mapa (ciudades, pueblos, parques, hitos, paradas de un roadtrip), no solo
// ciudades. Descarta calles y direcciones puntuales (demasiado finas). Devuelve
// `name` corto para mostrar/guardar y `hint` (región) para desambiguar.
export async function searchSpots(query) {
  const clean = query?.trim()
  if (!clean || clean.length < 2) return []
  const key = `ruta26_spot_search_v1_${clean.toLowerCase()}`
  const cached = localStorage.getItem(key)
  if (cached) return JSON.parse(cached)
  const params = new URLSearchParams({ limit:'12', q:clean })
  const response = await fetch(`https://photon.komoot.io/api/?${params}`)
  if (!response.ok) throw new Error('No se pudieron buscar lugares')
  const data = await response.json()
  const seen = new Set()
  const results = (data.features || [])
    .filter(feature => {
      const properties = feature.properties || {}
      return properties.name && properties.osm_key !== 'highway' && !properties.housenumber
    })
    .map(feature => {
      const properties = feature.properties || {}
      const [longitude, latitude] = feature.geometry?.coordinates || []
      const hint = [properties.state, properties.country].filter(Boolean).join(', ')
      return {
        id:`${properties.osm_type || ''}-${properties.osm_id || properties.name}`,
        name:properties.name,
        label:[properties.name, hint].filter(Boolean).join(', '),
        hint,
        latitude:Number(latitude),
        longitude:Number(longitude)
      }
    })
    .filter(spot => {
      const dedupe = spot.label.toLowerCase()
      if (seen.has(dedupe)) return false
      seen.add(dedupe)
      return true
    })
    .slice(0, 6)
  localStorage.setItem(key, JSON.stringify(results))
  return results
}

export async function getWeather(lat, lon, date) {
  if (!date) return null
  const params = new URLSearchParams({
    latitude:String(lat),
    longitude:String(lon),
    daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone:'auto',
    start_date:date,
    end_date:date
  })
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!response.ok) throw new Error('No se pudo obtener el clima')
  const { daily } = await response.json()
  if (!daily?.time?.length) return null
  return {
    max:daily.temperature_2m_max[0],
    min:daily.temperature_2m_min[0],
    rain:daily.precipitation_probability_max[0]
  }
}
