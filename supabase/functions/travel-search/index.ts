import { createClient } from 'npm:@supabase/supabase-js'
import { getPlaceDetails, getPlacePhoto, hasTripadvisor, nearbyPlaces, searchAttractionCandidates, searchPlaces } from '../_shared/travel-places.ts'
import { normName, searchWikiPlaces } from '../_shared/wiki-places.ts'
import { loadSettings, UserQuotaExceededError } from '../_shared/quota.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers:{ ...cors, 'Content-Type':'application/json' }
  })

const haversineKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const toRad = (v: number) => v * Math.PI / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// ¿Coincide el nombre de Wikipedia con el del candidato de Tripadvisor? Conservador:
// uno contiene al otro, o todas las palabras significativas del más corto están en
// el más largo. Mejor sin match que un match equivocado (rating de otro lugar).
const namesMatch = (a: string, b: string) => {
  const na = normName(a)
  const nb = normName(b)
  if (!na || !nb) return false
  if (na === nb || na.includes(nb) || nb.includes(na)) return true
  const tokens = (s: string) => s.split(' ').filter(word => word.length > 2)
  const ta = tokens(na)
  const tb = tokens(nb)
  if (!ta.length || !tb.length) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)]
  return shorter.every(word => longer.has(word))
}

// Enriquece las primeras `limit` atracciones de Wikipedia con su ficha de
// Tripadvisor (rating, reseñas, ranking, precio) conservando la foto gratis de
// Wikipedia. Una búsqueda de candidatos (0 cuota) + un /details (1 cuota) por
// match verificado por cercanía. Corta al agotarse la cuota → el resto queda
// como Wikipedia gratis.
// deno-lint-ignore no-explicit-any
async function enrichAttractions(places: any[], opts: { latitude: number, longitude: number, language?: string, currency?: string, userId: string, limit: number }) {
  const { latitude, longitude, language, currency, userId, limit } = opts
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !places.length) return places
  let candidates: { locationId: string, name: string, address: string }[] = []
  try {
    candidates = await searchAttractionCandidates({ latitude, longitude, radiusKm: 12, language })
  } catch (error) {
    console.warn('Tripadvisor candidate search failed', error instanceof Error ? error.message : error)
    return places
  }
  if (!candidates.length) return places
  for (const place of places.slice(0, limit)) {
    const candidate = candidates.find(item => namesMatch(place.name, item.name))
    if (!candidate) continue
    try {
      const details = await getPlaceDetails(candidate.locationId, { language, currency, userId })
      if (details.latitude != null && place.latitude != null &&
        haversineKm(Number(place.latitude), Number(place.longitude), details.latitude, details.longitude) > 0.6) continue
      place.rating = details.rating
      place.reviewCount = details.reviewCount
      place.ranking = details.ranking
      place.priceLevel = details.priceLevel
      place.tripadvisorUrl = details.tripadvisorUrl
      place.tripadvisorLocationId = details.locationId
      if (!place.address && details.address) place.address = details.address
      place.provider = 'wikipedia+tripadvisor'
    } catch (error) {
      if (error instanceof UserQuotaExceededError || (error instanceof Error && error.message.includes('monthly limit reached'))) break
      console.warn('Tripadvisor enrich detail failed', error instanceof Error ? error.message : error)
    }
  }
  return places
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:cors })

  try {
    const authHeader = request.headers.get('Authorization') || ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global:{ headers:{ Authorization:authHeader } } }
    )
    const { data:{ user } } = await supabase.auth.getUser()
    if (!user) return json({ error:'Unauthorized' }, 401)
    const body = await request.json()
    const settings = await loadSettings()

    // Atracciones (todo lo que no es comida ni hoteles) → Wikipedia/Wikimedia para
    // DESCUBRIR gratis (cobertura amplia + foto). Si el cliente pide `enrich` y hay
    // cuota, las primeras se enriquecen con la ficha de Tripadvisor (rating, etc.).
    // Comida y hoteles siguen 100% en Tripadvisor.
    const wantsWiki = body.category !== 'restaurants' && body.category !== 'hotels'
    if (wantsWiki && (!body.action || body.action === 'search' || body.action === 'nearby')) {
      try {
        // El seed (sugerencias al abrir, sin texto) y "buscar en esta zona" usan
        // geosearch alrededor del ancla: la búsqueda por texto de Wikipedia no
        // entiende frases tipo "mejores atracciones imperdibles" y devolvía vacío.
        // Solo usamos texto cuando el usuario realmente escribió una consulta.
        const places = await searchWikiPlaces({
          query:body.action === 'nearby' || body.seed ? '' : body.query,
          city:body.city,
          latitude:body.latitude,
          longitude:body.longitude,
          radiusKm:body.radiusKm,
          language:body.language,
          limit:body.limit
        })
        if (body.enrich && hasTripadvisor() && settings.taEnabled && places.length) {
          await enrichAttractions(places, {
            latitude:Number(body.latitude),
            longitude:Number(body.longitude),
            language:body.language,
            currency:body.currency,
            userId:user.id,
            limit:Math.min(Math.max(Number(body.enrichLimit) || 6, 1), 8)
          })
        }
        // deno-lint-ignore no-explicit-any
        const enriched = Boolean(body.enrich) && places.some((place: any) => place.tripadvisorLocationId)
        return json({ provider:enriched ? 'wikipedia+tripadvisor' : 'wikipedia', places, externalContent:enriched })
      } catch (error) {
        console.warn('Wikipedia search failed', error)
        return json({ provider:'wikipedia', places:[], externalContent:false })
      }
    }

    // De aquí en adelante se usa Tripadvisor: validar configuración + kill switch.
    if (!hasTripadvisor()) return json({ error:'Tripadvisor no está configurado' }, 503)
    if (!settings.taEnabled) {
      return json({ error:'La búsqueda de lugares está desactivada por el administrador.', killSwitch:true, quotaExceeded:true }, 429)
    }

    if (body.action === 'details') {
      if (!body.locationId) return json({ error:'locationId es requerido' }, 400)
      const place = await getPlaceDetails(body.locationId, {
        language:body.language,
        currency:body.currency,
        userId:user.id
      })
      return json({ provider:'tripadvisor', place, externalContent:true })
    }

    if (body.action === 'photos') {
      if (!body.locationId) return json({ error:'locationId es requerido' }, 400)
      try {
        const photo = await getPlacePhoto(body.locationId, { language:body.language, userId:user.id })
        return json({ provider:'tripadvisor', photo, externalContent:true })
      } catch (error) {
        // Las fotos degradan a placeholder en vez de romper: si se acabó la cuota
        // devolvemos url vacía con 200 para no llenar de errores el front.
        if (error instanceof UserQuotaExceededError || (error instanceof Error && error.message.includes('monthly limit reached'))) {
          return json({ provider:'tripadvisor', photo:{ url:'', attribution:'' }, limitReached:true })
        }
        throw error
      }
    }

    if (body.action === 'nearby') {
      if (body.latitude == null || body.longitude == null) return json({ error:'latitude y longitude son requeridos' }, 400)
      const places = await nearbyPlaces({
        latitude:Number(body.latitude),
        longitude:Number(body.longitude),
        category:body.category,
        radiusKm:body.radiusKm,
        language:body.language,
        currency:body.currency,
        limit:body.limit,
        userId:user.id
      })
      return json({ provider:'tripadvisor', places, externalContent:true })
    }

    if (!body.query) return json({ error:'query es requerido' }, 400)
    const places = await searchPlaces({
      query:body.query,
      city:body.city,
      category:body.category,
      latitude:body.latitude,
      longitude:body.longitude,
      radiusKm:body.radiusKm,
      language:body.language,
      currency:body.currency,
      limit:body.limit,
      userId:user.id
    })
    return json({ provider:'tripadvisor', places, externalContent:true })
  } catch (error) {
    if (error instanceof UserQuotaExceededError) {
      return json({
        error:`Alcanzaste tu límite mensual de búsquedas de lugares (${error.used}/${error.limit}). Se renueva el próximo mes.`,
        limitReached:true, kind:'ta', used:error.used, limit:error.limit, remaining:0
      }, 429)
    }
    const message = error instanceof Error ? error.message : 'Unexpected error'
    if (message.includes('monthly limit reached')) {
      return json({ error:'Tripadvisor quota mensual alcanzada. Búsqueda externa pausada hasta el próximo mes.', quotaExceeded:true }, 429)
    }
    return json({ error:message }, 500)
  }
})
