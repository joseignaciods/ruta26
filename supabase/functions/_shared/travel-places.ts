const TRIPADVISOR_BASE = 'https://api.content.tripadvisor.com/api/v1'

export type PlaceCategory = 'hotels' | 'attractions' | 'restaurants' | 'geos'

type SearchOptions = {
  query: string
  city?: string
  category?: PlaceCategory
  latitude?: number
  longitude?: number
  radiusKm?: number
  language?: string
  currency?: string
  limit?: number
}

const apiKey = () => Deno.env.get('TRIPADVISOR_API_KEY') || ''

const request = async (path: string, params: Record<string, string | number | undefined>) => {
  const key = apiKey()
  if (!key) throw new Error('TRIPADVISOR_API_KEY no está configurada')
  const query = new URLSearchParams({ key })
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(name, String(value))
  }
  const response = await fetch(`${TRIPADVISOR_BASE}${path}?${query}`)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Tripadvisor respondió ${response.status}: ${body.slice(0, 180)}`)
  }
  return response.json()
}

const normalizeAddress = (value: Record<string, unknown> | undefined) =>
  String(value?.address_string || [
    value?.street1,
    value?.street2,
    value?.city,
    value?.state,
    value?.country
  ].filter(Boolean).join(', ') || '')

const normalizePlace = (row: Record<string, unknown>) => {
  const address = row.address_obj as Record<string, unknown> | undefined
  const latitude = Number(row.latitude)
  const longitude = Number(row.longitude)
  return {
    locationId:String(row.location_id || ''),
    name:String(row.name || ''),
    description:String(row.description || ''),
    address:normalizeAddress(address),
    latitude:Number.isFinite(latitude) ? latitude : null,
    longitude:Number.isFinite(longitude) ? longitude : null,
    rating:row.rating == null ? null : Number(row.rating),
    reviewCount:row.num_reviews == null ? null : Number(row.num_reviews),
    ranking:String(row.ranking || ''),
    priceLevel:String(row.price_level || ''),
    website:String(row.website || ''),
    phone:String(row.phone || ''),
    tripadvisorUrl:String(row.web_url || ''),
    category:String((row.category as Record<string, unknown> | undefined)?.localized_name || ''),
    subcategories:((row.subcategory as Record<string, unknown>[] | undefined) || [])
      .map(item => String(item.localized_name || ''))
      .filter(Boolean)
  }
}

export const hasTripadvisor = () => Boolean(apiKey())

export async function getPlaceDetails(
  locationId: string,
  options: { language?: string, currency?: string } = {}
) {
  const data = await request(`/location/${encodeURIComponent(locationId)}/details`, {
    language:options.language || 'es',
    currency:options.currency || 'USD'
  })
  return normalizePlace(data)
}

export async function searchPlaces(options: SearchOptions) {
  const limit = Math.min(Math.max(Number(options.limit || 5), 1), 8)
  const searchQuery = [options.query, options.city].filter(Boolean).join(' ')
  const data = await request('/location/search', {
    searchQuery,
    category:options.category,
    latLong:options.latitude != null && options.longitude != null
      ? `${options.latitude},${options.longitude}`
      : undefined,
    radius:options.radiusKm,
    radiusUnit:options.radiusKm ? 'km' : undefined,
    language:options.language || 'es'
  })
  const matches = ((data.data || []) as Record<string, unknown>[]).slice(0, limit)
  const details = await Promise.all(matches.map(async match => {
    const locationId = String(match.location_id || '')
    if (!locationId) return normalizePlace(match)
    try {
      return await getPlaceDetails(locationId, {
        language:options.language,
        currency:options.currency
      })
    } catch {
      return normalizePlace(match)
    }
  }))
  return details
}
