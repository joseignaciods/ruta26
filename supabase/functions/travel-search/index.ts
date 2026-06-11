import { createClient } from 'npm:@supabase/supabase-js'
import { getPlaceDetails, hasTripadvisor, searchPlaces } from '../_shared/travel-places.ts'

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
    if (!hasTripadvisor()) return json({ error:'Tripadvisor no está configurado' }, 503)

    const body = await request.json()
    if (body.action === 'details') {
      if (!body.locationId) return json({ error:'locationId es requerido' }, 400)
      const place = await getPlaceDetails(body.locationId, {
        language:body.language,
        currency:body.currency
      })
      return json({ provider:'tripadvisor', place, externalContent:true })
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
      limit:body.limit
    })
    return json({ provider:'tripadvisor', places, externalContent:true })
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
