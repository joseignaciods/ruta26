import OpenAI from 'npm:openai'
import { createClient } from 'npm:@supabase/supabase-js'
import { hasTripadvisor, nearbyPlaces, searchPlaces } from '../_shared/travel-places.ts'
import { searchWikiPlaces } from '../_shared/wiki-places.ts'
import { searchOsmFood } from '../_shared/osm-places.ts'
import { ensureAndConsumeUserQuota, loadSettings, recordOpenAIUsage, UserQuotaExceededError } from '../_shared/quota.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Normaliza para comparar nombres (sin tildes, minúsculas) en el anti-repetición.
const norm = (value: unknown) =>
  String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const trim = (text: unknown, max = 120) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

const distanceKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const toRad = (v: number) => v * Math.PI / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const formatDuration = (minutes: unknown) => {
  const total = Math.max(15, Math.min(360, Math.round(Number(minutes) || 60)))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest ? `${hours}h ${rest}min` : `${hours}h`
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = request.headers.get('Authorization') || ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const body = await request.json()
    const day = body.day || {}
    const anchor = day.anchor || {}
    const lat = Number(anchor.latitude)
    const lon = Number(anchor.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json({ error: 'No se pudo ubicar el lugar del día en el mapa. Elige una ciudad o lugar de las sugerencias.' }, 400)
    }
    // Puntos de la ruta del día: origen → paradas de paso → destino. Sin ruta
    // (o un solo punto) se comporta igual que antes: todo alrededor del ancla.
    // deno-lint-ignore no-explicit-any
    const routePoints = (Array.isArray(day.route) ? day.route : [])
      .map((p: any) => ({ name: String(p?.name || ''), lat: Number(p?.latitude), lon: Number(p?.longitude), role: String(p?.role || 'stop') }))
      .filter((p: { lat: number, lon: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    if (!routePoints.length) routePoints.push({ name: String(anchor.label || day.city || ''), lat, lon, role: 'origin' })
    const isRoute = routePoints.length > 1
    const prefs = body.preferences || {}
    const exclude = body.exclude || {}
    const language = body.language || 'es'
    const currency = body.currency || 'USD'

    // Kill switch + cuota de IA por usuario (1 unidad por día generado), igual que trip-assistant.
    const settings = await loadSettings()
    if (!settings.aiEnabled) {
      return json({ error: 'El asistente IA está temporalmente desactivado por el administrador.', limitReached: true, kind: 'ai', killSwitch: true, used: 0, limit: 0, remaining: 0 }, 429)
    }
    try {
      await ensureAndConsumeUserQuota(user.id, 'ai', 1)
    } catch (error) {
      if (error instanceof UserQuotaExceededError) {
        return json({ error: `Alcanzaste tu límite mensual del asistente IA (${error.used}/${error.limit}). Se renueva el día 1 del próximo mes.`, limitReached: true, kind: 'ai', used: error.used, limit: error.limit, remaining: 0 }, 429)
      }
      throw error
    }

    const meta = { aiUsed: true, taConsumed: 0, excludedCount: 0, taSkipped: false, fewCandidates: false, foodSource: 'tripadvisor' }

    // --- GATHER: atracciones gratis (Wikipedia) + comida (Tripadvisor, con cuota) ---
    // deno-lint-ignore no-explicit-any
    let attractions: any[] = []
    const seenAttr = new Set<string>()
    for (let i = 0; i < routePoints.length; i++) {
      const point = routePoints[i]
      try {
        const found = await searchWikiPlaces({ latitude: point.lat, longitude: point.lon, radiusKm: isRoute ? 6 : 8, limit: isRoute ? 8 : 14, language })
        for (const place of found) {
          const key = String(place.locationId || place.name)
          if (seenAttr.has(key)) continue
          seenAttr.add(key)
          place._leg = i
          place._near = point.name
          attractions.push(place)
        }
      } catch (error) {
        console.warn('Wikipedia gather failed', error instanceof Error ? error.message : error)
      }
    }

    // deno-lint-ignore no-explicit-any
    let restaurants: any[] = []
    const cuisines = ((prefs.cuisines || []) as string[]).filter(Boolean).slice(0, 3)
    const wantsFood = prefs.includeFood !== false
    if (wantsFood) {
      let gotTripadvisor = false
      if (hasTripadvisor() && settings.taEnabled) {
        try {
          if (cuisines.length) {
            // Buscar por cada cocina elegida (sushi, mexicana, etc.) y combinar sin
            // repetir; acota la cuota repartiendo el límite entre las cocinas.
            const per = Math.max(1, Math.floor(5 / cuisines.length))
            const seenFood = new Set<string>()
            for (const cuisine of cuisines) {
              const found = await searchPlaces({ query: cuisine, category: 'restaurants', latitude: lat, longitude: lon, radiusKm: 6, limit: per, language, currency, userId: user.id })
              for (const place of found) {
                if (place.locationId && !seenFood.has(place.locationId)) { seenFood.add(place.locationId); restaurants.push(place) }
              }
            }
          } else {
            restaurants = await nearbyPlaces({ latitude: lat, longitude: lon, category: 'restaurants', radiusKm: 6, limit: 4, language, currency, userId: user.id })
          }
          meta.taConsumed = restaurants.length
          gotTripadvisor = true
        } catch (error) {
          console.warn('Tripadvisor food gather failed, trying OpenStreetMap', error instanceof Error ? error.message : error)
        }
      }
      // Sin Tripadvisor (sin key, apagado o cuota agotada) → comida gratis de OSM,
      // así el día igual tiene dónde comer (sin reseñas).
      if (!gotTripadvisor) {
        meta.taSkipped = true
        try {
          restaurants = await searchOsmFood({ latitude: lat, longitude: lon, radiusKm: 6, limit: 5 })
          if (restaurants.length) meta.foodSource = 'openstreetmap'
        } catch (error) {
          console.warn('OpenStreetMap food gather failed', error instanceof Error ? error.message : error)
        }
      }
    }

    // Etiqueta la comida ya reunida (cerca del origen) y, si es ruta, suma
    // opciones cerca del destino para la cena/llegada.
    restaurants.forEach(place => { place._leg = 0; place._near = routePoints[0].name })
    if (isRoute && wantsFood) {
      const destPoint = routePoints[routePoints.length - 1]
      try {
        let destFood: any[] = []
        if (hasTripadvisor() && settings.taEnabled) {
          destFood = await nearbyPlaces({ latitude: destPoint.lat, longitude: destPoint.lon, category: 'restaurants', radiusKm: 6, limit: 3, language, currency, userId: user.id })
          meta.taConsumed += destFood.length
        }
        if (!destFood.length) destFood = await searchOsmFood({ latitude: destPoint.lat, longitude: destPoint.lon, radiusKm: 6, limit: 3 })
        const seenDestFood = new Set(restaurants.map(r => String(r.locationId)))
        for (const place of destFood) {
          if (place.locationId && seenDestFood.has(String(place.locationId))) continue
          place._leg = routePoints.length - 1
          place._near = destPoint.name
          restaurants.push(place)
        }
      } catch (error) {
        console.warn('Dest food gather failed', error instanceof Error ? error.message : error)
      }
    }

    // --- FILTER: anti-repetición en código (no se confía al modelo) ---
    const exIds = new Set((exclude.ids || []).map((id: unknown) => String(id)))
    const exNames = new Set((exclude.names || []).map(norm))
    const exCoords = ((exclude.coords || []) as unknown[]).filter(c => Array.isArray(c) && c.length === 2) as number[][]
    // deno-lint-ignore no-explicit-any
    const isExcluded = (place: any) => {
      if (place.locationId && exIds.has(String(place.locationId))) return true
      if (exNames.has(norm(place.name))) return true
      if (place.latitude != null && place.longitude != null && exCoords.some(([elat, elon]) =>
        distanceKm(Number(elat), Number(elon), Number(place.latitude), Number(place.longitude)) < 0.12)) return true
      return false
    }
    const beforeCount = attractions.length + restaurants.length
    attractions = attractions.filter(p => !isExcluded(p) && p.latitude != null && p.longitude != null)
    restaurants = restaurants.filter(p => !isExcluded(p) && p.latitude != null && p.longitude != null)
    meta.excludedCount = beforeCount - (attractions.length + restaurants.length)

    // Mapa id -> registro autoritativo (coords/foto/categoría vienen de aquí, nunca del modelo).
    // deno-lint-ignore no-explicit-any
    const candidates = new Map<string, any>()
    const attractionPayload = attractions.map(place => {
      candidates.set(String(place.locationId), { ...place, kind: 'attraction' })
      return {
        id: String(place.locationId),
        name: place.name,
        lat: place.latitude,
        lon: place.longitude,
        distKm: Number(distanceKm(lat, lon, Number(place.latitude), Number(place.longitude)).toFixed(2)),
        blurb: trim(place.description, 110),
        hasPhoto: Boolean(place.imageUrl),
        leg: place._leg ?? 0,
        near: place._near || ''
      }
    })
    const foodPayload = restaurants.map(place => {
      candidates.set(String(place.locationId), { ...place, kind: 'food' })
      return {
        id: String(place.locationId),
        name: place.name,
        lat: place.latitude,
        lon: place.longitude,
        distKm: Number(distanceKm(lat, lon, Number(place.latitude), Number(place.longitude)).toFixed(2)),
        rating: place.rating,
        reviewCount: place.reviewCount,
        priceLevel: place.priceLevel,
        leg: place._leg ?? 0,
        near: place._near || ''
      }
    })

    if (!attractionPayload.length && !foodPayload.length) {
      return json({
        plan: { dayId: day.dayId || null, date: day.date || '', city: day.city || '', daySummary: '', stops: [] },
        meta: { ...meta, fewCandidates: true }
      })
    }
    if (attractionPayload.length < 3) meta.fewCandidates = true

    // --- CURATE: una sola llamada a OpenAI, salida JSON, elige SOLO de los candidatos ---
    const paceTargets: Record<string, string> = { relaxed: '3 a 4', balanced: '5 a 6', intense: '7 a 8' }
    const pace = paceTargets[prefs.pace as string] || paceTargets.balanced
    const dayTypeLabel: Record<string, string> = { culture: 'cultura y museos', nature: 'aire libre y naturaleza', entertainment: 'entretención', food: 'gastronomía' }
    const dayTypes = ((prefs.dayTypes || []) as string[]).map(t => dayTypeLabel[t] || t).filter(Boolean)
    const cultureTypes = ((prefs.cultureTypes || []) as string[]).filter(Boolean)

    // Puntos intermedios CON NOMBRE (paradas de paso reales). Los puntos "via"
    // muestreados de la carretera van sin nombre: sirven para buscar panoramas a
    // lo largo del trayecto, pero no se listan en la descripción de la ruta.
    const namedVias = routePoints.slice(1, -1).map(p => p.name).filter(Boolean)

    const system = [
      'Eres un planificador de viajes experto. Armas el itinerario de UN solo día, realista y bien paceado. Respondes en español.',
      'Elige ÚNICAMENTE lugares de la lista de candidatos provista, usando su "id" exacto. NUNCA inventes lugares, ids, coordenadas ni datos.',
      `Apunta a ${pace} paradas en total, acorde al ritmo pedido.`,
      'Optimiza geográficamente: agrupa paradas por sector/barrio cercano y ordénalas para minimizar desplazamientos (usa lat/lon y distKm).',
      isRoute ? `DÍA DE TRASLADO: empiezas en "${routePoints[0].name}" y terminas en "${routePoints[routePoints.length - 1].name}"${namedVias.length ? `, pasando por: ${namedVias.join(', ')}` : ''}. Hay candidatos repartidos a lo largo de la carretera (campo "leg": 0 = origen, mayor = más cerca del destino). Ordena el día SIGUIENDO LA RUTA por "leg": primero lo del origen (mañana), luego lo de los tramos intermedios en orden de "leg" (paradas de paso en la carretera), y termina en el destino (tarde/noche). Almuerzo hacia el medio y cena en el destino. No vuelvas atrás en la ruta.` : '',
      'Intercala comidas en horarios realistas usando los candidatos de comida: almuerzo ~13:30 y cena ~20:30 (desayuno ~09:00 solo si el ritmo lo permite).',
      'Asigna a cada parada una hora de inicio (HH:MM, 24h) y una duración en minutos realista, en orden cronológico.',
      'Para cada parada incluye "whyPicked": una frase breve (máx 80 caracteres) que explique por qué vale la pena, sin copiar reseñas.',
      dayTypes.length ? `Prioriza este tipo de día: ${dayTypes.join(', ')}.` : 'Arma un día equilibrado: imperdibles + algo de comer.',
      cuisines.length ? `Para las comidas prioriza estos tipos de cocina: ${cuisines.join(', ')}.` : '',
      cultureTypes.length ? `En lo cultural prioriza: ${cultureTypes.join(', ')}.` : '',
      prefs.freeText ? `Instrucción del viajero (PRIORIDAD MÁXIMA, respétala): ${String(prefs.freeText).slice(0, 400)}` : '',
      'Responde SOLO con un objeto JSON válido, sin texto extra, con esta forma exacta:',
      '{"daySummary":"resumen corto del día, máx 90 caracteres","stops":[{"id":"<id de un candidato>","category":"culture|food|nature|entertainment","time":"HH:MM","durationMin":90,"sector":"sector o barrio","whyPicked":"frase breve"}]}'
    ].filter(Boolean).join('\n')

    const userPayload = {
      city: day.city,
      date: day.date,
      anchor: { lat, lon, label: anchor.label || day.city },
      route: isRoute ? routePoints.filter((p: { name: string }) => p.name).map((p: { name: string, role: string }) => ({ name: p.name, role: p.role })) : undefined,
      candidates: { attractions: attractionPayload, restaurants: foodPayload }
    }

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini'
    const response = await openai.responses.create({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(userPayload) }
      ],
      text: { format: { type: 'json_object' } }
    })
    await recordOpenAIUsage(user.id, model, response.usage)

    // --- VALIDATE: parsear, verificar ids contra el mapa, re-adjuntar datos autoritativos ---
    // deno-lint-ignore no-explicit-any
    let parsed: any = {}
    try {
      parsed = JSON.parse(response.output_text || '{}')
    } catch {
      // Reintento de reparación: extrae el primer bloque {...} si vino con texto alrededor.
      const match = (response.output_text || '').match(/\{[\s\S]*\}/)
      try { parsed = match ? JSON.parse(match[0]) : {} } catch { parsed = {} }
    }
    const rawStops = Array.isArray(parsed.stops) ? parsed.stops : []
    const seen = new Set<string>()
    // deno-lint-ignore no-explicit-any
    const stops: any[] = []
    for (const stop of rawStops) {
      const candidate = candidates.get(String(stop?.id))
      if (!candidate) continue
      const key = String(candidate.locationId)
      if (seen.has(key)) continue
      seen.add(key)
      const isFood = candidate.kind === 'food'
      const requested = ['culture', 'food', 'nature', 'entertainment', 'transport'].includes(stop?.category) ? stop.category : null
      stops.push({
        name: candidate.name,
        time: /^\d{1,2}:\d{2}$/.test(stop?.time || '') ? stop.time : '',
        duration: formatDuration(stop?.durationMin),
        category: isFood ? 'food' : (requested && requested !== 'food' ? requested : 'culture'),
        address: candidate.address || '',
        latitude: candidate.latitude ?? null,
        longitude: candidate.longitude ?? null,
        priceLabel: isFood ? String(candidate.priceLevel || '') : '',
        // Solo las atracciones de Wikipedia traen foto gratis embebida; la comida de
        // Tripadvisor queda con id para pedir la foto bajo demanda. La comida de OSM
        // (id 'osm-…') no tiene foto en Tripadvisor, así que no se guarda el id.
        tripadvisorLocationId: isFood && !String(candidate.locationId || '').startsWith('osm-') ? String(candidate.locationId || '') : '',
        imageUrl: isFood ? '' : String(candidate.imageUrl || ''),
        provider: candidate.provider || (isFood ? 'tripadvisor' : 'wikipedia'),
        rating: isFood ? candidate.rating ?? null : null,
        whyPicked: trim(stop?.whyPicked, 80),
        sector: trim(stop?.sector, 40)
      })
    }
    // Orden cronológico de respaldo por si el modelo no respetó el orden.
    stops.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))

    return json({
      plan: {
        dayId: day.dayId || null,
        date: day.date || '',
        city: day.city || '',
        daySummary: trim(parsed.daySummary || '', 90),
        stops
      },
      meta
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado'
    return json({ error: message }, 500)
  }
})
