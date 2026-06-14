import OpenAI from 'npm:openai'
import { createClient } from 'npm:@supabase/supabase-js'
import { getPlaceDetails, hasTripadvisor, searchPlaces } from '../_shared/travel-places.ts'
import { ensureAndConsumeUserQuota, loadSettings, UserQuotaExceededError } from '../_shared/quota.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const tools = [
  {
    type: 'function',
    name: 'add_day',
    description: 'Agrega un día a la ruta del viaje',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        title: { type: 'string' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD, opcional' }
      },
      required: ['city']
    }
  },
  {
    type: 'function',
    name: 'add_activity',
    description: 'Agrega una actividad o panorama a un día existente de la ruta',
    parameters: {
      type: 'object',
      properties: {
        day_id: { type: 'string', description: 'id del día (uuid, viene en el contexto del viaje)' },
        name: { type: 'string' },
        time: { type: 'string', description: 'Hora HH:MM, opcional' },
        description: { type: 'string' },
        address: { type: 'string' },
        category: { type: 'string', description: 'food | culture | nature | entertainment | transport' },
        price_label: { type: 'string', description: 'Precio aproximado como texto, ej "15 EUR"' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        tripadvisor_location_id: { type: 'string', description: 'location_id factual del resultado de Tripadvisor' }
      },
      required: ['day_id', 'name']
    }
  },
  {
    type: 'function',
    name: 'update_activity',
    description: 'Modifica campos de un panorama existente. Úsala para reemplazar un plan manteniendo su lugar en el día.',
    parameters: {
      type: 'object',
      properties: {
        activity_id: { type: 'string' },
        name: { type: 'string' },
        time: { type: 'string' },
        description: { type: 'string' },
        address: { type: 'string' },
        category: { type: 'string' },
        price_label: { type: 'string' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        tripadvisor_location_id: { type: 'string', description: 'location_id factual del resultado de Tripadvisor' }
      },
      required: ['activity_id']
    }
  },
  {
    type: 'function',
    name: 'delete_activity',
    description: 'Elimina un panorama del viaje. Solo tras confirmación explícita del usuario.',
    parameters: {
      type: 'object',
      properties: { activity_id: { type: 'string' } },
      required: ['activity_id']
    }
  },
  {
    type: 'function',
    name: 'move_activity',
    description: 'Mueve un panorama a otro día (queda al final del día destino)',
    parameters: {
      type: 'object',
      properties: {
        activity_id: { type: 'string' },
        target_day_id: { type: 'string' },
        time: { type: 'string', description: 'Nueva hora HH:MM, opcional' }
      },
      required: ['activity_id', 'target_day_id']
    }
  },
  {
    type: 'function',
    name: 'update_day',
    description: 'Modifica ciudad, título, subtítulo o fecha de un día',
    parameters: {
      type: 'object',
      properties: {
        day_id: { type: 'string' },
        city: { type: 'string' },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' }
      },
      required: ['day_id']
    }
  },
  {
    type: 'function',
    name: 'delete_day',
    description: 'Elimina un día completo y sus panoramas. Solo tras confirmación explícita del usuario.',
    parameters: {
      type: 'object',
      properties: { day_id: { type: 'string' } },
      required: ['day_id']
    }
  },
  {
    type: 'function',
    name: 'add_expense',
    description: 'Registra un gasto del viaje',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        category: { type: 'string' }
      },
      required: ['description', 'amount']
    }
  },
  {
    type: 'function',
    name: 'add_hotel',
    description: 'Agrega un alojamiento al viaje',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        name: { type: 'string' },
        address: { type: 'string' },
        check_in: { type: 'string', description: 'YYYY-MM-DD' },
        check_out: { type: 'string', description: 'YYYY-MM-DD' }
      },
      required: ['city', 'name']
    }
  },
  {
    type: 'function',
    name: 'set_trip_preferences',
    description: 'Guarda preferencias durables del grupo (dieta, niños, presupuesto, ritmo). Solo tras confirmar con el usuario.',
    parameters: {
      type: 'object',
      properties: { notes: { type: 'string' } },
      required: ['notes']
    }
  },
  {
    type: 'function',
    name: 'add_packing_item',
    description: 'Agrega un ítem a la lista de equipaje',
    parameters: {
      type: 'object',
      properties: { item: { type:'string' }, category: { type:'string' } },
      required: ['item']
    }
  },
  {
    type: 'function',
    name: 'get_weather',
    description: 'Pronóstico (máx, mín, probabilidad de lluvia) para coordenadas y fecha. Úsalo antes de sugerir planes al aire libre.',
    parameters: {
      type: 'object',
      properties: {
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD' }
      },
      required: ['latitude', 'longitude', 'date']
    }
  },
  {
    type: 'function',
    name: 'search_places',
    description: 'Busca en Tripadvisor atracciones, restaurantes u hoteles reales para recomendar al usuario',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Qué buscar, por ejemplo museos, comida local o hotel boutique' },
        city: { type: 'string' },
        category: { type: 'string', enum: ['hotels', 'attractions', 'restaurants', 'geos'] },
        limit: { type: 'number', description: 'Cantidad de resultados, entre 1 y 8' }
      },
      required: ['query', 'city']
    }
  },
  {
    type: 'function',
    name: 'search_nearby_places',
    description: 'Busca lugares reales cerca de coordenadas conocidas, útil para reemplazar un plan sin traslados largos',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        radius_km: { type: 'number' },
        category: { type: 'string', enum: ['hotels', 'attractions', 'restaurants', 'geos'] },
        limit: { type: 'number' }
      },
      required: ['query', 'latitude', 'longitude']
    }
  },
  {
    type: 'function',
    name: 'get_place_details',
    description: 'Obtiene detalles actuales de Tripadvisor para un location_id encontrado anteriormente',
    parameters: {
      type: 'object',
      properties: {
        location_id: { type: 'string' }
      },
      required: ['location_id']
    }
  }
]

const nextPosition = (rows: { position?: number }[] | null) =>
  (rows || []).reduce((max, row) => Math.max(max, row.position || 0), 0) + 1

const externalTools = new Set(['search_places', 'search_nearby_places', 'get_place_details'])
const writeTools = new Set(['add_day', 'add_activity', 'add_expense', 'add_hotel', 'add_packing_item', 'update_activity', 'delete_activity', 'move_activity', 'update_day', 'delete_day', 'set_trip_preferences'])

// deno-lint-ignore no-explicit-any
const pickActivityFields = (args: any) => {
  const fields: Record<string, unknown> = {}
  for (const key of ['name', 'time', 'description', 'address', 'category', 'price_label', 'latitude', 'longitude', 'tripadvisor_location_id']) {
    if (args[key] !== undefined) fields[key] = args[key]
  }
  return fields
}

// deno-lint-ignore no-explicit-any
async function runTool(supabase: any, tripId: string, userId: string, name: string, args: any) {
  try {
    if (name === 'add_day') {
      const { data: rows } = await supabase.from('days').select('position').eq('trip_id', tripId)
      const { data, error } = await supabase.from('days').insert({
        trip_id: tripId,
        position: nextPosition(rows),
        city: args.city,
        title: args.title || `Día en ${args.city}`,
        date: args.date || null,
        created_by: userId
      }).select('id,position,city,title,date').single()
      if (error) return { error: error.message }
      return { ok:true, changed:true, day:data }
    }
    if (name === 'add_activity') {
      const { data: rows } = await supabase.from('activities').select('position').eq('day_id', args.day_id)
      const { data, error } = await supabase.from('activities').insert({
        trip_id: tripId,
        day_id: args.day_id,
        position: nextPosition(rows),
        name: args.name,
        time: args.time || null,
        description: args.description || '',
        address: args.address || '',
        category: args.category || 'entertainment',
        price_label: args.price_label || '',
        latitude: args.latitude ?? null,
        longitude: args.longitude ?? null,
        tripadvisor_location_id: args.tripadvisor_location_id || null,
        created_by: userId
      }).select('id,day_id,name,time').single()
      if (error) return { error: error.message }
      return { ok:true, changed:true, activity:data }
    }
    if (name === 'update_activity') {
      const fields = pickActivityFields(args)
      if (!Object.keys(fields).length) return { error:'No hay campos para actualizar' }
      fields.updated_by = userId
      const { data, error } = await supabase.from('activities').update(fields)
        .eq('id', args.activity_id).eq('trip_id', tripId).select('id,name,time').single()
      if (error) return { error: error.message }
      return { ok:true, changed:true, activity:data }
    }
    if (name === 'delete_activity') {
      const { error } = await supabase.from('activities').delete().eq('id', args.activity_id).eq('trip_id', tripId)
      if (error) return { error: error.message }
      return { ok:true, changed:true, deleted:args.activity_id }
    }
    if (name === 'move_activity') {
      const { data: rows } = await supabase.from('activities').select('position').eq('day_id', args.target_day_id)
      const fields: Record<string, unknown> = { day_id:args.target_day_id, position:nextPosition(rows), updated_by:userId }
      if (args.time !== undefined) fields.time = args.time
      const { data, error } = await supabase.from('activities').update(fields)
        .eq('id', args.activity_id).eq('trip_id', tripId).select('id,day_id,name,time').single()
      if (error) return { error: error.message }
      return { ok:true, changed:true, activity:data }
    }
    if (name === 'update_day') {
      const fields: Record<string, unknown> = {}
      for (const key of ['city', 'title', 'subtitle', 'date']) {
        if (args[key] !== undefined) fields[key] = args[key]
      }
      if (!Object.keys(fields).length) return { error:'No hay campos para actualizar' }
      fields.updated_by = userId
      const { data, error } = await supabase.from('days').update(fields)
        .eq('id', args.day_id).eq('trip_id', tripId).select('id,city,title,date').single()
      if (error) return { error: error.message }
      return { ok:true, changed:true, day:data }
    }
    if (name === 'delete_day') {
      const { error } = await supabase.from('days').delete().eq('id', args.day_id).eq('trip_id', tripId)
      if (error) return { error: error.message }
      return { ok:true, changed:true, deleted:args.day_id }
    }
    if (name === 'add_expense') {
      const { data, error } = await supabase.from('expenses').insert({
        trip_id: tripId,
        description: args.description,
        amount: args.amount,
        currency: args.currency || 'USD',
        category: args.category || 'activity',
        date: args.date || null,
        paid_by: userId
      }).select('id,description,amount,currency').single()
      if (error) return { error: error.message }
      return { ok:true, changed:true, expense:data }
    }
    if (name === 'add_hotel') {
      const { data, error } = await supabase.from('hotels').insert({
        trip_id: tripId,
        city: args.city,
        name: args.name,
        address: args.address || '',
        check_in: args.check_in || null,
        check_out: args.check_out || null
      }).select('id,name,city').single()
      if (error) return { error: error.message }
      return { ok:true, changed:true, hotel:data }
    }
    if (name === 'set_trip_preferences') {
      const { error } = await supabase.from('trips').update({ preferences:{ notes:String(args.notes || '') } }).eq('id', tripId)
      if (error) return { error: error.message }
      return { ok:true, changed:true, preferences:{ notes:args.notes } }
    }
    if (name === 'add_packing_item') {
      const { data, error } = await supabase.from('packing_items').insert({
        trip_id:tripId,
        item:args.item,
        category:args.category || 'essential'
      }).select('id,item').single()
      if (error) return { error:error.message }
      return { ok:true, changed:true, packingItem:data }
    }
    if (name === 'get_weather') {
      const params = new URLSearchParams({
        latitude:String(args.latitude),
        longitude:String(args.longitude),
        daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        timezone:'auto',
        start_date:args.date,
        end_date:args.date
      })
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
      if (!response.ok) return { error:`Open-Meteo respondió ${response.status}` }
      const { daily } = await response.json()
      if (!daily?.time?.length) return { error:'Sin pronóstico para esa fecha' }
      return { ok:true, changed:false, weather:{ max:daily.temperature_2m_max[0], min:daily.temperature_2m_min[0], rain:daily.precipitation_probability_max[0] } }
    }
    if (name === 'search_places' || name === 'search_nearby_places') {
      if (!hasTripadvisor()) {
        return { error:'Tripadvisor no está configurado en el backend' }
      }
      const places = await searchPlaces({
        query:args.query,
        city:args.city,
        category:args.category,
        latitude:name === 'search_nearby_places' ? args.latitude : undefined,
        longitude:name === 'search_nearby_places' ? args.longitude : undefined,
        radiusKm:name === 'search_nearby_places' ? args.radius_km : undefined,
        language:'es',
        limit:args.limit || 5,
        userId
      })
      return {
        ok:true,
        changed:false,
        externalContent:true,
        provider:'Tripadvisor',
        places
      }
    }
    if (name === 'get_place_details') {
      if (!hasTripadvisor()) {
        return { error:'Tripadvisor no está configurado en el backend' }
      }
      const place = await getPlaceDetails(args.location_id, { language:'es', userId })
      return {
        ok:true,
        changed:false,
        externalContent:true,
        provider:'Tripadvisor',
        place
      }
    }
    return { error: `Herramienta desconocida: ${name}` }
  } catch (error) {
    if (error instanceof UserQuotaExceededError) {
      return { error:'Alcanzaste tu límite mensual de búsquedas de lugares. Se renueva el próximo mes.' }
    }
    return { error: error instanceof Error ? error.message : 'Error ejecutando herramienta' }
  }
}

const splitReplies = (text: string) => {
  const match = text.match(/\n?\s*\/\/\/sugerencias:(.*)$/s)
  if (!match) return { text, suggestedReplies: [] as string[] }
  return {
    text: text.slice(0, match.index).trimEnd(),
    suggestedReplies: match[1].split('|').map(item => item.trim()).filter(Boolean).slice(0, 3)
  }
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

	  const { tripId, messages = [], externalContentInHistory = false } = await request.json()
	  const settings = await loadSettings()
	  if (!settings.aiEnabled) {
	    return json({
	      error:'El asistente IA está temporalmente desactivado por el administrador.',
	      limitReached:true, kind:'ai', killSwitch:true, used:0, limit:0, remaining:0
	    }, 429)
	  }
	  const cleanMessages = Array.isArray(messages)
    ? messages
      .filter(message =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
      )
      .map(message => ({ role:message.role, content:message.content }))
    : []
  const { data: trip } = await supabase
    .from('trips')
    .select('id,name,start_date,end_date,currency,timezone,preferences,days(id,position,date,city,title,activities(id,position,name,time,category,address,latitude,longitude,price_label,tripadvisor_location_id)),hotels(id,city,name,address,check_in,check_out),expenses(description,amount,currency,date)')
    .eq('id', tripId)
    .single()
	  if (!trip) return json({ error: 'Forbidden' }, 403)
	  try {
	    await ensureAndConsumeUserQuota(user.id, 'ai', 1)
	  } catch (error) {
	    if (error instanceof UserQuotaExceededError) {
	      return json({
	        error:`Alcanzaste tu límite mensual del asistente IA (${error.used}/${error.limit}). Se renueva el día 1 del próximo mes.`,
	        limitReached:true, kind:'ai', used:error.used, limit:error.limit, remaining:0
	      }, 429)
	    }
	    throw error
	  }

  const preferenceNotes = (trip.preferences as { notes?: string } | null)?.notes || ''
  const system = [
    'Eres el asistente de viajes de Ruta26. Respondes siempre en español, de forma breve y práctica.',
    `Hoy es ${new Date().toISOString().slice(0, 10)}.`,
    `Ayudas a planificar el viaje "${trip.name}". Puedes MODIFICAR el viaje usando las herramientas (agregar, editar, mover y eliminar días, panoramas, gastos y hoteles).`,
    'REGLA DE CONFIRMACIÓN: nunca uses delete_activity, delete_day, update_activity, move_activity, update_day ni set_trip_preferences sin que el usuario haya confirmado explícitamente ese cambio en su último mensaje. Primero propone 2 o 3 opciones concretas con horario, luego espera el OK.',
    'Flujo para "lugar cerrado" o "quiero cambiar este plan": (1) identifica la actividad en el contexto por su id; (2) busca 2 o 3 alternativas reales cercanas con search_nearby_places usando sus coordenadas (o search_places con la ciudad si no hay coordenadas), de la misma categoría salvo que pidan otra cosa; (3) preséntalas con horario propuesto; (4) tras la confirmación aplica update_activity.',
    'Si el usuario expresa desgano o cambio de ánimo sin decir qué quiere, ofrécele 3 moods de categorías distintas (ej: algo tranquilo al aire libre / comida cerca / dejar la tarde libre) antes de buscar.',
    'Considera el clima: si una actividad es al aire libre, consulta get_weather con sus coordenadas y fecha; si hay lluvia probable adviértelo y prioriza alternativas bajo techo.',
    hasTripadvisor()
      ? 'Puedes buscar lugares actuales en Tripadvisor. Úsalo cuando el usuario pida recomendaciones, restaurantes, hoteles o panoramas reales.'
      : 'Tripadvisor no está configurado. No inventes ratings, precios, horarios ni datos actuales de lugares.',
    'Cuando uses Tripadvisor, menciona la fuente, incluye el enlace cuando exista y aclara que los datos se consultaron en vivo. No copies reseñas textuales; resume rating y cantidad de opiniones.',
    'Los resultados de search_places y search_nearby_places se mostrarán automáticamente como tarjetas seleccionables. Preséntalos brevemente por nombre y pide elegir uno; no listes URLs genéricas.',
    'search_places y search_nearby_places ya devuelven detalles suficientes. No llames get_place_details para cada resultado salvo que falte un dato imprescindible solicitado por el usuario.',
    'Al guardar lugares encontrados en Tripadvisor incluye solo nombre, dirección, coordenadas, categoría y tripadvisor_location_id; nunca copies su descripción ni reseñas en los campos description o tip.',
    'Cuando el usuario pida armar una ruta o agregar cosas, usa las herramientas y confirma brevemente qué hiciste.',
    'Para agregar actividades necesitas el day_id exacto del contexto; si el día no existe, créalo primero con add_day.',
    'Si en tu respuesta esperas una elección o confirmación del usuario, termina con UNA línea exacta con este formato: ///sugerencias: opción uno | opción dos | opción tres (máximo 3, cortas). En cualquier otro caso no agregues esa línea.',
    preferenceNotes ? `Preferencias del grupo (respétalas siempre): ${preferenceNotes}` : '',
    `Contexto actual del viaje (JSON): ${JSON.stringify(trip)}`
  ].filter(Boolean).join('\n')

  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
  // deno-lint-ignore no-explicit-any
  let input: any[] = [
    { role: 'system', content: system },
    ...cleanMessages.slice(-20)
  ]
  let changed = false
  let externalContent = Boolean(externalContentInHistory)
  const sources = new Set<string>()
  // deno-lint-ignore no-explicit-any
  const placeSuggestions = new Map<string, any>()
  const actions: { tool:string, label:string, id:string, parentId?:string }[] = []

  for (let round = 0; round < 6; round++) {
    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini'
    const response = await openai.responses.create({ model, input, tools })
    // deno-lint-ignore no-explicit-any
    const calls = response.output.filter((item: any) => item.type === 'function_call')
    if (!calls.length) {
      const { text, suggestedReplies } = splitReplies(response.output_text)
      return json({ text, suggestedReplies, changed, externalContent, sources:[...sources], placeSuggestions:[...placeSuggestions.values()].slice(0, 5), actions })
    }

    input = input.concat(response.output)
    const roundUsesExternalData = calls.some(call => externalTools.has(call.name))
    for (const call of calls) {
      let args = {}
      try {
        args = JSON.parse(call.arguments || '{}')
      } catch {
        args = {}
      }
      // Con datos de Tripadvisor en juego solo se persisten campos factuales:
      // se vacían description/tip para no copiar contenido con derechos del proveedor.
      if ((externalContent || roundUsesExternalData) && (call.name === 'add_activity' || call.name === 'update_activity')) {
        // deno-lint-ignore no-explicit-any
        const sanitized = args as any
        delete sanitized.description
        args = sanitized
      }
      const result = await runTool(supabase, tripId, user.id, call.name, args)
      if ('activity' in result && result.activity?.id) {
        actions.push({ tool:call.name, label:`${result.activity.name || 'Panorama'} → ruta`, id:result.activity.id, parentId:result.activity.day_id })
      } else if ('day' in result && result.day?.id) {
        actions.push({ tool:call.name, label:`${result.day.title || result.day.city || 'Día'} → ruta`, id:result.day.id })
      } else if ('expense' in result && result.expense?.id) {
        actions.push({ tool:call.name, label:`${result.expense.description} → gastos`, id:result.expense.id })
      } else if ('hotel' in result && result.hotel?.id) {
        actions.push({ tool:call.name, label:`${result.hotel.name} → hoteles`, id:result.hotel.id })
      } else if ('packingItem' in result && result.packingItem?.id) {
        actions.push({ tool:call.name, label:`${result.packingItem.item} → equipaje`, id:result.packingItem.id })
      }
      if ('changed' in result && result.changed) changed = true
      if ('externalContent' in result && result.externalContent) externalContent = true
      if ('places' in result && Array.isArray(result.places)) {
        for (const place of result.places) {
          if (place.tripadvisorUrl) sources.add(place.tripadvisorUrl)
          const key = String(place.locationId || place.tripadvisorUrl || place.name || '')
          if (key && !placeSuggestions.has(key)) placeSuggestions.set(key, place)
        }
      }
      if ('place' in result && result.place?.tripadvisorUrl) {
        sources.add(result.place.tripadvisorUrl)
        const key = String(result.place.locationId || result.place.tripadvisorUrl || result.place.name || '')
        if (key && !placeSuggestions.has(key)) placeSuggestions.set(key, result.place)
      }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
    }
  }

  const collectedPlaces = [...placeSuggestions.values()].slice(0, 5)
  return json({
    text:changed
      ? 'Apliqué los cambios al viaje. Revisa la ruta y dime si quieres ajustar algo.'
      : collectedPlaces.length
        ? 'Encontré estas alternativas en Tripadvisor. Revisa los detalles y elige una para aplicar el cambio.'
        : 'No alcancé a completar la solicitud. Intenta nuevamente con una instrucción más específica.',
    suggestedReplies:[],
    changed,
    externalContent,
    sources:[...sources],
    placeSuggestions:collectedPlaces,
    actions
  })
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
