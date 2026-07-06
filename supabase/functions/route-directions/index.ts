import { createClient } from 'npm:@supabase/supabase-js'

// Geometría de ruta de manejo (OpenRouteService) para dibujar el trayecto real
// del día en el mapa (origen → paradas → destino). La API key vive como secreto
// del servidor (ORS_API_KEY); el cliente nunca la ve.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson'

// Llama a ORS Directions y normaliza la respuesta. Adjunta el status HTTP al
// error para distinguir key inválida (403) de límite diario (429) u otros.
async function orsDirections(coordinates: number[][], key: string) {
  const response = await fetch(ORS_URL, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates })
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const raw = data?.error?.message ?? data?.error ?? `ORS respondió ${response.status}`
    const error = new Error(typeof raw === 'string' ? raw : JSON.stringify(raw)) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  const feature = data?.features?.[0]
  const line: number[][] = feature?.geometry?.coordinates || []
  const summary = feature?.properties?.summary || {}
  // Un "segment" por tramo entre waypoints consecutivos (para tiempos por tramo).
  const segments: { distance?: number, duration?: number }[] = feature?.properties?.segments || []
  return {
    // GeoJSON entrega [lon, lat]; Leaflet usa [lat, lon].
    geometry: line.map(point => [point[1], point[0]]),
    distanceKm: summary.distance != null ? summary.distance / 1000 : null,
    durationMin: summary.duration != null ? summary.duration / 60 : null,
    legs: segments.map(segment => ({
      distanceKm: (segment.distance || 0) / 1000,
      durationMin: (segment.duration || 0) / 60
    }))
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const key = Deno.env.get('ORS_API_KEY')
    if (!key) return json({ error: 'OpenRouteService no está configurado (falta ORS_API_KEY).' }, 503)

    const body = await request.json().catch(() => ({}))

    // Chequeo de salud de la key: un mini-request a ORS. No expone la key ni datos
    // del usuario, solo si responde OK. Sirve para validar la configuración.
    if (body.action === 'health') {
      try {
        await orsDirections([[8.681495, 49.41461], [8.686507, 49.41943]], key)
        return json({ ok: true })
      } catch (error) {
        const status = (error as Error & { status?: number }).status || 0
        return json({ ok: false, status, error: error instanceof Error ? error.message : 'error' })
      }
    }

    // El cálculo de ruta requiere sesión de usuario, como el resto de funciones.
    const authHeader = request.headers.get('Authorization') || ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    // El cliente manda coordinates en [lon, lat] ya ordenadas (origen → destino).
    const raw = Array.isArray(body.coordinates) ? body.coordinates : []
    const coordinates = raw
      .filter((point: unknown) => Array.isArray(point) && point.length === 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map((point: number[]) => [Number(point[0]), Number(point[1])])
    if (coordinates.length < 2) return json({ error: 'Se necesitan al menos 2 puntos (origen y destino).' }, 400)

    const route = await orsDirections(coordinates, key)
    return json({ provider: 'openrouteservice', ...route })
  } catch (error) {
    const status = (error as Error & { status?: number }).status
    if (status === 403) return json({ error: 'La API key de OpenRouteService es inválida o sin permiso.' }, 502)
    if (status === 429) return json({ error: 'Se alcanzó el límite diario de OpenRouteService. Intenta más tarde.' }, 429)
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
