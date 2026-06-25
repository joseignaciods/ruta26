import { createClient } from 'npm:@supabase/supabase-js'
import { getPlaceDetails, getPlacePhoto, hasTripadvisor, nearbyPlaces, searchPlaces } from '../_shared/travel-places.ts'
import { searchWikiPlaces } from '../_shared/wiki-places.ts'
import { searchOsmFood } from '../_shared/osm-places.ts'
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
    // Atracciones (Imperdibles/Cultura/Aire libre): TRIPADVISOR PRIMARIO para que la
    // categoría SÍ filtre (museos, parques, lo mejor) con foto, rating y reseñas. Si
    // TA no está disponible (sin key, apagado o cuota agotada), cae a Wikipedia
    // (gratis) — que cerca de una ciudad solo trae edificios notables.
    const wantsWiki = body.category !== 'restaurants' && body.category !== 'hotels'
    if (wantsWiki && (!body.action || body.action === 'search' || body.action === 'nearby')) {
      const lat = Number(body.latitude)
      const lon = Number(body.longitude)
      const userText = String(body.query || '').trim()
      // Palabras de búsqueda en Tripadvisor para las sugerencias (seed) por categoría.
      const seedQuery: Record<string, string> = {
        culture: 'museos monumentos lugares históricos',
        nature: 'parques jardines naturaleza miradores'
      }
      if (hasTripadvisor() && settings.taEnabled) {
        try {
          let places
          if (body.seed && body.category === 'entertainment') {
            // Imperdibles sin texto → lo mejor cerca del ancla.
            places = await nearbyPlaces({ latitude: lat, longitude: lon, category: 'attractions', radiusKm: body.radiusKm || 12, language: body.language, currency: body.currency, limit: body.limit, userId: user.id })
          } else if (body.action === 'nearby' && !userText) {
            // "Buscar en esta zona" sin texto → atracciones del área visible.
            places = await nearbyPlaces({ latitude: lat, longitude: lon, category: 'attractions', radiusKm: body.radiusKm, language: body.language, currency: body.currency, limit: body.limit, userId: user.id })
          } else {
            // Cultura / Aire libre (seed) → palabras por categoría; o el texto del usuario.
            const query = (body.seed && seedQuery[body.category]) || userText || body.query
            places = await searchPlaces({ query, city: body.city, category: 'attractions', latitude: lat, longitude: lon, radiusKm: body.radiusKm, language: body.language, currency: body.currency, limit: body.limit, userId: user.id })
          }
          return json({ provider: 'tripadvisor', places, externalContent: true })
        } catch (error) {
          const quota = error instanceof UserQuotaExceededError || (error instanceof Error && error.message.includes('monthly limit reached'))
          if (!quota) console.warn('Tripadvisor attractions failed, falling back to Wikipedia', error instanceof Error ? error.message : error)
          // Cae a Wikipedia (cuota agotada, sin key o error).
        }
      }
      // Respaldo gratuito: Wikipedia (geosearch + filtro de eventos).
      try {
        const places = await searchWikiPlaces({
          query: body.action === 'nearby' || body.seed ? '' : body.query,
          city: body.city,
          latitude: body.latitude,
          longitude: body.longitude,
          radiusKm: body.radiusKm,
          language: body.language,
          limit: body.limit
        })
        return json({ provider: 'wikipedia', places, externalContent: false })
      } catch (error) {
        console.warn('Wikipedia search failed', error)
        return json({ provider: 'wikipedia', places: [], externalContent: false })
      }
    }

    // Comida ("Comer"): Tripadvisor mientras haya créditos; si NO está disponible
    // (sin key, apagado o cuota agotada), cae a OpenStreetMap (gratis) para no
    // quedar sin opciones de dónde comer. Solo las listas (search / nearby).
    if (body.category === 'restaurants' && (!body.action || body.action === 'search' || body.action === 'nearby')) {
      const lat = Number(body.latitude)
      const lon = Number(body.longitude)
      if (hasTripadvisor() && settings.taEnabled) {
        try {
          const places = body.action === 'nearby'
            ? await nearbyPlaces({ latitude:lat, longitude:lon, category:'restaurants', radiusKm:body.radiusKm, language:body.language, currency:body.currency, limit:body.limit, userId:user.id })
            : await searchPlaces({ query:body.query, city:body.city, category:'restaurants', latitude:body.latitude, longitude:body.longitude, radiusKm:body.radiusKm, language:body.language, currency:body.currency, limit:body.limit, userId:user.id })
          return json({ provider:'tripadvisor', places, externalContent:true })
        } catch (error) {
          // Cualquier fallo de Tripadvisor (cuota agotada incluida) → OpenStreetMap.
          console.warn('Tripadvisor food failed, falling back to OpenStreetMap', error instanceof Error ? error.message : error)
        }
      }
      const places = await searchOsmFood({ latitude:lat, longitude:lon, radiusKm:body.radiusKm || 6, limit:body.limit })
      return json({ provider:'openstreetmap', places, externalContent:false, taFallback:true })
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
