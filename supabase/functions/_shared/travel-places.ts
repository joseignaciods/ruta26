import { ensureAndConsumeTripadvisorQuota, UserQuotaExceededError } from './quota.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const TRIPADVISOR_BASE = 'https://api.content.tripadvisor.com/api/v1'

// Caché compartida de fichas de Tripadvisor (service role, 30 días). Evita gastar
// cuota dos veces por el mismo lugar — clave porque enriquecer atracciones gasta
// rápido. Es mejor esfuerzo: si la caché falla, se consulta a Tripadvisor normal.
const cacheClient = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const DETAILS_CACHE_DAYS = 30

const readDetailsCache = async (locationId: string) => {
  try {
    const { data } = await cacheClient()
      .from('ta_details_cache')
      .select('payload, updated_at')
      .eq('location_id', locationId)
      .maybeSingle()
    if (!data?.payload) return null
    const ageMs = Date.now() - new Date(data.updated_at as string).getTime()
    return ageMs > DETAILS_CACHE_DAYS * 86_400_000 ? null : data.payload
  } catch {
    return null
  }
}

const writeDetailsCache = async (locationId: string, payload: unknown) => {
  try {
    await cacheClient().from('ta_details_cache').upsert({ location_id: locationId, payload, updated_at: new Date().toISOString() })
  } catch { /* mejor esfuerzo: la caché no debe romper la búsqueda */ }
}

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
  userId?: string
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
    // El ranking real viene en ranking_data.ranking_string ("#5 de 200 cosas que
    // hacer en …"); row.ranking casi siempre llega vacío.
    ranking:String((row.ranking_data as Record<string, unknown> | undefined)?.ranking_string || row.ranking || ''),
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
  options: { language?: string, currency?: string, userId?: string } = {}
) {
  if (!options.userId) throw new Error('userId es requerido para consultar Tripadvisor')
  // Caché primero: si la ficha está fresca, NO gasta cuota.
  const cached = await readDetailsCache(locationId)
  if (cached) return cached as ReturnType<typeof normalizePlace>
  await ensureAndConsumeTripadvisorQuota(options.userId, 1)
  const data = await request(`/location/${encodeURIComponent(locationId)}/details`, {
    language:options.language || 'es',
    currency:options.currency || 'USD'
  })
  const place = normalizePlace(data)
  await writeDetailsCache(locationId, place)
  return place
}

// Una sola foto del lugar (espejo de getPlaceDetails). Cada llamada consume 1
// unidad de cuota igual que un detalle, así que el front la pide bajo demanda y
// la cachea. Devuelve url vacía si el lugar no tiene fotos.
export async function getPlacePhoto(
  locationId: string,
  options: { language?: string, userId?: string } = {}
) {
  if (!options.userId) throw new Error('userId es requerido para consultar Tripadvisor')
  await ensureAndConsumeTripadvisorQuota(options.userId, 1)
  const data = await request(`/location/${encodeURIComponent(locationId)}/photos`, {
    language:options.language || 'es',
    limit:1
  })
  const first = ((data.data || []) as Record<string, unknown>[])[0]
  if (!first) return { url:'', attribution:'' }
  const images = first.images as Record<string, { url?: string }> | undefined
  const pick = images?.large || images?.medium || images?.original || images?.small || images?.thumbnail
  const source = first.source as Record<string, unknown> | undefined
  const user = first.user as Record<string, unknown> | undefined
  return {
    url:String(pick?.url || ''),
    attribution:String(source?.localized_name || user?.username || 'Tripadvisor')
  }
}

const enrichMatches = async (
  matches: Record<string, unknown>[],
  options: { language?: string, currency?: string, userId?: string }
) => {
  const details: ReturnType<typeof normalizePlace>[] = []
  for (const match of matches) {
    const locationId = String(match.location_id || '')
    if (!locationId) { details.push(normalizePlace(match)); continue }
    try {
      details.push(await getPlaceDetails(locationId, {
        language:options.language,
        currency:options.currency,
        userId:options.userId
      }))
    } catch (error) {
      if (error instanceof UserQuotaExceededError) throw error
      if (error instanceof Error && error.message.includes('monthly limit reached')) {
        details.push(normalizePlace(match))
        break
      }
      details.push(normalizePlace(match))
    }
  }
  return details
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
  return enrichMatches(matches, options)
}

// Candidatos crudos de atracciones cerca de un punto, SIN /details → 0 cuota.
// Sirve para emparejar lugares de Wikipedia con su ficha de Tripadvisor antes
// de gastar una unidad en el detalle solo de los que hacen match.
export async function searchAttractionCandidates(
  options: { latitude: number, longitude: number, radiusKm?: number, language?: string }
) {
  const data = await request('/location/nearby_search', {
    latLong:`${options.latitude},${options.longitude}`,
    category:'attractions',
    radius:options.radiusKm ? Math.ceil(options.radiusKm) : undefined,
    radiusUnit:options.radiusKm ? 'km' : undefined,
    language:options.language || 'es'
  })
  return ((data.data || []) as Record<string, unknown>[]).map(row => ({
    locationId:String(row.location_id || ''),
    name:String(row.name || ''),
    address:normalizeAddress(row.address_obj as Record<string, unknown> | undefined)
  }))
}

type NearbyOptions = {
  latitude: number
  longitude: number
  category?: PlaceCategory
  radiusKm?: number
  language?: string
  currency?: string
  limit?: number
  userId?: string
}

// Browse por área sin texto: /location/nearby_search no exige searchQuery,
// ideal para "buscar en esta zona" desde el mapa.
export async function nearbyPlaces(options: NearbyOptions) {
  const limit = Math.min(Math.max(Number(options.limit || 5), 1), 8)
  const data = await request('/location/nearby_search', {
    latLong:`${options.latitude},${options.longitude}`,
    category:options.category,
    radius:options.radiusKm ? Math.ceil(options.radiusKm) : undefined,
    radiusUnit:options.radiusKm ? 'km' : undefined,
    language:options.language || 'es'
  })
  const matches = ((data.data || []) as Record<string, unknown>[]).slice(0, limit)
  return enrichMatches(matches, options)
}
