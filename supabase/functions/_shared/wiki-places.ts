// Proveedor de lugares gratuito y sin API key basado en Wikipedia/Wikimedia.
// Una sola llamada devuelve, por lugar: título, foto (Wikimedia), coordenadas y
// un extracto. Para atracciones (no comida): geosearch cerca de un punto cuando
// no hay texto, o búsqueda por texto cuando el usuario escribe.

type WikiOptions = {
  query?: string
  city?: string
  latitude?: number
  longitude?: number
  radiusKm?: number
  language?: string
  limit?: number
}

const USER_AGENT = 'Ruta26/1.0 (https://ruta26-rosy.vercel.app; contacto@ruta26.app)'

const trim = (text: string, max = 180) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

const normalize = (page: Record<string, any>, lang: string) => {
  const coord = (page.coordinates && page.coordinates[0]) || null
  return {
    locationId: `wiki-${page.pageid}`,
    name: String(page.title || ''),
    description: trim(page.extract || ''),
    address: '',
    latitude: coord ? Number(coord.lat) : null,
    longitude: coord ? Number(coord.lon) : null,
    rating: null,
    reviewCount: null,
    ranking: '',
    priceLevel: '',
    imageUrl: page.thumbnail?.source ? String(page.thumbnail.source) : '',
    url: `https://${lang}.wikipedia.org/?curid=${page.pageid}`,
    provider: 'wikipedia',
    category: '',
    subcategories: [] as string[]
  }
}

export async function searchWikiPlaces(options: WikiOptions) {
  const lang = options.language || 'es'
  const limit = Math.min(Math.max(Number(options.limit || 6), 1), 12)
  const text = (options.query || '').trim()
  const hasGeo = options.latitude != null && options.longitude != null
  const fetchN = String(Math.min(20, limit * 3))

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '1',
    prop: 'pageimages|coordinates|extracts',
    piprop: 'thumbnail',
    pithumbsize: '600',
    exintro: '1',
    explaintext: '1',
    // Sin exlimit, los extracts via generator solo vuelven para 1 página (el
    // resto queda sin descripción). fetchN ≤ 20, el máximo que permite la API.
    exlimit: fetchN
  })

  if (text) {
    params.set('generator', 'search')
    params.set('gsrsearch', [text, options.city].filter(Boolean).join(' '))
    params.set('gsrlimit', fetchN)
  } else if (hasGeo) {
    params.set('generator', 'geosearch')
    params.set('ggscoord', `${options.latitude}|${options.longitude}`)
    params.set('ggsradius', String(Math.min(10000, Math.max(1000, Math.round((options.radiusKm || 8) * 1000)))))
    params.set('ggslimit', fetchN)
  } else {
    return []
  }

  const response = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`Wikipedia respondió ${response.status}`)
  const data = await response.json()
  const pages = (Object.values(data?.query?.pages || {}) as Record<string, any>[])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

  const cityLower = (options.city || '').trim().toLowerCase()
  const seen = new Set<string>()
  return pages
    // Foto + coordenadas = lugar real (descarta artículos genéricos, empresas, etc.)
    .filter(page => page.thumbnail?.source && page.coordinates?.[0])
    .filter(page => String(page.title || '').toLowerCase() !== cityLower)
    .map(page => normalize(page, lang))
    .filter(place => { if (seen.has(place.locationId)) return false; seen.add(place.locationId); return true })
    .slice(0, limit)
}
