// Proveedor de comida GRATUITO basado en OpenStreetMap (Overpass API). Sin API key
// ni cuota. Se usa como respaldo de "Comer" cuando Tripadvisor no está disponible
// (sin key, kill switch o cuota agotada), para que la búsqueda de comida nunca
// quede vacía. Trae nombre, ubicación y tipo de cocina; NO trae reseñas, rating ni
// precio (eso solo lo tiene Tripadvisor).

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
]
const USER_AGENT = 'Ruta26/1.0 (https://ruta26-rosy.vercel.app; contacto@ruta26.app)'

// Algunas cocinas frecuentes de OSM traducidas; el resto se muestra tal cual.
const CUISINE_ES: Record<string, string> = {
  italian: 'Italiana', pizza: 'Pizza', japanese: 'Japonesa', sushi: 'Sushi', chinese: 'China',
  mexican: 'Mexicana', thai: 'Tailandesa', indian: 'India', french: 'Francesa', spanish: 'Española',
  greek: 'Griega', burger: 'Hamburguesas', seafood: 'Mariscos', steak_house: 'Parrilla',
  barbecue: 'Parrilla', asado: 'Parrilla', vegetarian: 'Vegetariana', vegan: 'Vegana',
  coffee_shop: 'Café', regional: 'Local', peruvian: 'Peruana', american: 'Americana',
  korean: 'Coreana', vietnamese: 'Vietnamita', lebanese: 'Libanesa', asian: 'Asiática',
  mediterranean: 'Mediterránea', sandwich: 'Sándwiches', ice_cream: 'Heladería', chicken: 'Pollo'
}
const AMENITY_LABEL: Record<string, string> = {
  restaurant: 'Restaurante', cafe: 'Café', bar: 'Bar', pub: 'Bar', fast_food: 'Comida rápida',
  food_court: 'Patio de comidas', ice_cream: 'Heladería'
}

const haversineKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const toRad = (v: number) => v * Math.PI / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

type OsmOptions = { latitude: number, longitude: number, radiusKm?: number, limit?: number }

export async function searchOsmFood(options: OsmOptions) {
  const lat = Number(options.latitude)
  const lon = Number(options.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
  const radius = Math.round(Math.min(15000, Math.max(500, (options.radiusKm || 6) * 1000)))
  const limit = Math.min(Math.max(Number(options.limit || 8), 1), 12)
  const query = `[out:json][timeout:20];
(
  node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court|ice_cream)$"]["name"](around:${radius},${lat},${lon});
);
out body ${limit * 5};`

  // deno-lint-ignore no-explicit-any
  let data: any = null
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: `data=${encodeURIComponent(query)}`
      })
      if (!response.ok) continue
      data = await response.json()
      if (data?.elements) break
    } catch {
      // probar el siguiente endpoint de Overpass
    }
  }
  if (!data?.elements?.length) return []

  return (data.elements as Record<string, any>[])
    .filter(element => element.tags?.name && element.lat != null && element.lon != null)
    .map(element => {
      const tags = element.tags || {}
      const cuisineRaw = String(tags.cuisine || '').split(';')[0].trim().toLowerCase()
      const cuisine = CUISINE_ES[cuisineRaw] || (cuisineRaw ? cuisineRaw.replace(/_/g, ' ') : '')
      const amenityLabel = AMENITY_LABEL[String(tags.amenity || '')] || 'Restaurante'
      const address = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(' ')
      return {
        locationId: `osm-${element.id}`,
        name: String(tags.name),
        description: '',
        address,
        latitude: Number(element.lat),
        longitude: Number(element.lon),
        rating: null,
        reviewCount: null,
        // Reusamos "ranking" para mostrar el tipo (Tripadvisor pone su ranking aquí);
        // OSM no tiene rating/precio, así surface al menos qué tipo de lugar es.
        ranking: [amenityLabel, cuisine].filter(Boolean).join(' · '),
        priceLevel: '',
        website: String(tags.website || tags['contact:website'] || ''),
        phone: String(tags.phone || tags['contact:phone'] || ''),
        tripadvisorUrl: '',
        url: String(tags.website || tags['contact:website'] || `https://www.openstreetmap.org/node/${element.id}`),
        imageUrl: '',
        // 'food' para que el front lo trate como comida directamente.
        category: 'food',
        provider: 'openstreetmap',
        subcategories: cuisine ? [cuisine] : []
      }
    })
    .sort((a, b) => haversineKm(lat, lon, a.latitude, a.longitude) - haversineKm(lat, lon, b.latitude, b.longitude))
    .slice(0, limit)
}
