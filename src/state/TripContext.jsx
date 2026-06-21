import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { hasSupabase, supabase } from '../lib/supabase.js'
import { localStore } from '../lib/localStore.js'
import { geocodeQuery } from '../lib/geo.js'
import { placeCacheKey, readPlaceCache, writePlaceCache } from '../lib/placeCache.js'
import { useAuth } from './AuthContext.jsx'
import { useToast } from './ToastContext.jsx'

const TripContext = createContext(null)
const SNAPSHOT_KEY = 'ruta26_snapshot'
const optimisticId = () => `optimistic-${crypto.randomUUID()}`

const byPosition = (a, b) => (a.position || a.day || 0) - (b.position || b.day || 0)
const nextPos = list => (list || []).reduce((max, item) => Math.max(max, item.position || item.day || 0), 0) + 1

const mapActivity = row => ({
  id:row.id,
  dayId:row.day_id ?? row.dayId,
  position:row.position,
  name:row.name,
  time:row.time || '',
  duration:row.duration || '',
  address:row.address || '',
  category:row.category || 'entertainment',
  priceLabel:row.price_label ?? row.priceLabel ?? '',
  expenseAmount:Number(row.expense_amount ?? row.expenseAmount ?? 0),
  expenseCurrency:row.expense_currency ?? row.expenseCurrency ?? '',
  latitude:row.latitude ?? null,
  longitude:row.longitude ?? null,
  tripadvisorLocationId:row.tripadvisor_location_id ?? row.tripadvisorLocationId ?? '',
  imageUrl:row.image_url ?? row.imageUrl ?? '',
  done:!!row.done
})

// Categoría de gasto para un panorama/hotel enlazado.
const expenseCategoryFor = category =>
  category === 'food' ? 'food' : category === 'transport' ? 'transport' : 'activity'

const mapTrip = (row, profiles = {}) => ({
  id:row.id,
  name:row.name,
  startDate:row.start_date ?? row.startDate ?? '',
  endDate:row.end_date ?? row.endDate ?? '',
  currency:row.currency,
  timezone:row.timezone,
  preferences:row.preferences || {},
  ownerId:row.owner_id ?? row.ownerId,
  members:(row.trip_members || row.members || []).map(member => ({
    id:member.id,
    userId:member.user_id ?? member.userId,
    name:profiles[member.user_id ?? member.userId] || member.name || '',
    email:member.email || '',
    role:member.role,
    status:member.status
  })),
  invitations:row.trip_invitations || row.invitations || [],
  days:(row.days || []).slice().sort(byPosition).map(day => ({
    ...day,
    position:day.position || day.day,
    activities:(day.activities || []).slice().sort(byPosition).map(mapActivity)
  })),
  hotels:(row.hotels || []).map(hotel => ({
    id:hotel.id,
    city:hotel.city,
    name:hotel.name,
    address:hotel.address || '',
    checkIn:hotel.check_in ?? hotel.checkIn ?? '',
    checkOut:hotel.check_out ?? hotel.checkOut ?? '',
    latitude:hotel.latitude ?? null,
    longitude:hotel.longitude ?? null,
    cost:hotel.cost ?? null,
    costCurrency:hotel.cost_currency ?? hotel.costCurrency ?? ''
  })),
  expenses:(row.expenses || []).map(expense => ({
    id:expense.id,
    description:expense.description,
    amount:Number(expense.amount || 0),
    currency:expense.currency,
    category:expense.category || 'activity',
    date:expense.date || '',
    paidBy:expense.paid_by ?? expense.paidBy ?? null,
    activityId:expense.activity_id ?? expense.activityId ?? null,
    hotelId:expense.hotel_id ?? expense.hotelId ?? null,
    isSettlement:!!(expense.is_settlement ?? expense.isSettlement),
    split:expense.split || {}
  })),
  packingItems:(row.packing_items || row.packingItems || []).map(item => ({ id:item.id, item:item.item, packed:!!item.packed }))
})

export function TripProvider({ children }) {
  const { user } = useAuth()
  const toast = useToast()
  const [trips, setTrips] = useState([])
  const [activeTripId, setActiveTripId] = useState(localStorage.getItem('ruta26_active_trip'))
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setTrips([])
      return
    }
    setLoading(true)
    try {
      if (!hasSupabase) {
        setTrips(localStore.trips(user.id).map(trip => mapTrip(trip)))
      } else {
        const { data, error } = await supabase
          .from('trips')
          .select('*, trip_members(*), trip_invitations(*), days(*, activities(*)), hotels(*), expenses(*), packing_items(*)')
          .order('created_at', { ascending:false })
        if (error) throw error
        let profiles = {}
        const userIds = [...new Set(data.flatMap(trip => (trip.trip_members || []).map(member => member.user_id)))]
        if (userIds.length) {
          const { data: rows, error: profilesError } = await supabase.from('profiles').select('id,name').in('id', userIds)
          if (profilesError) throw profilesError
          profiles = Object.fromEntries((rows || []).map(row => [row.id, row.name]))
        }
        const mapped = data.map(row => mapTrip(row, profiles))
        setTrips(mapped)
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(mapped))
        setOffline(false)
      }
    } catch (error) {
      let snapshot = []
      if (hasSupabase) {
        try {
          snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]')
        } catch {
          localStorage.removeItem(SNAPSHOT_KEY)
        }
      }
      if (snapshot.length) {
        setTrips(snapshot)
        setOffline(true)
      } else toast(error.message || 'No se pudieron cargar los viajes')
    } finally {
      setLoading(false)
    }
  }, [user, toast])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (activeTripId) localStorage.setItem('ruta26_active_trip', activeTripId)
    else localStorage.removeItem('ruta26_active_trip')
  }, [activeTripId])

  useEffect(() => {
    if (!hasSupabase || !user) return
    let timer
    const debounced = () => { clearTimeout(timer); timer = setTimeout(refresh, 400) }
    const channel = supabase.channel('ruta26-sync')
      .on('postgres_changes', { event:'*', schema:'public' }, debounced)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(channel) }
  }, [user, refresh])

  const activeTrip = trips.find(trip => trip.id === activeTripId) || null

  const value = useMemo(() => {
    const updateActive = updater => setTrips(list => list.map(trip => trip.id === activeTripId ? updater(trip) : trip))
    const run = async fn => {
      try { return await fn() } catch (error) { toast(error.message || 'Error inesperado'); return null }
    }

    return ({
      trips, activeTrip, activeTripId, loading, offline, setActiveTripId, refresh,

      createTrip: values => run(async () => {
        let trip
        if (!hasSupabase) {
          trip = mapTrip(localStore.createTrip(user, values))
          setTrips(list => [trip, ...list])
        } else {
          const { data, error } = await supabase.rpc('create_trip', {
            p_name:values.name,
            p_start_date:values.startDate || null,
            p_end_date:values.endDate || null,
            p_currency:values.currency || 'USD',
            p_timezone:values.timezone || 'America/Santiago'
          })
          if (error) throw error
          trip = {
            id:data,
            name:values.name,
            startDate:values.startDate || '',
            endDate:values.endDate || '',
            currency:values.currency || 'USD',
            timezone:values.timezone || 'America/Santiago',
            preferences:{},
            ownerId:user.id,
            members:[{ id:optimisticId(), userId:user.id, name:user.name || '', email:user.email || '', role:'owner', status:'active' }],
            invitations:[],
            days:[],
            hotels:[],
            expenses:[],
            packingItems:[]
          }
          setTrips(list => [trip, ...list])
        }
        setActiveTripId(trip.id)
        return trip
      }),

      createEuropeDemo: () => run(async () => {
        if (hasSupabase) throw new Error('La demo automática está disponible solo en modo local')
        const trip = mapTrip(localStore.createEuropeDemo(user))
        setTrips(list => [trip, ...list])
        setActiveTripId(trip.id)
        return trip
      }),

      updateTrip: updates => run(async () => {
        if (!activeTrip) return
        updateActive(trip => ({ ...trip, ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)) }))
        if (!hasSupabase) localStore.updateTrip(activeTrip.id, updates)
        else {
          const payload = {
            name:updates.name,
            start_date:updates.startDate || null,
            end_date:updates.endDate || null,
            currency:updates.currency,
            timezone:updates.timezone
          }
          if (updates.preferences !== undefined) payload.preferences = updates.preferences
          const { error } = await supabase.from('trips').update(payload).eq('id', activeTrip.id)
          if (error) { await refresh(); throw error }
        }
        toast('Viaje actualizado', 'success')
      }),

      deleteTrip: tripId => run(async () => {
        setTrips(list => list.filter(trip => trip.id !== tripId))
        if (activeTripId === tripId) setActiveTripId(null)
        if (!hasSupabase) localStore.deleteTrip(tripId)
        else {
          const { error } = await supabase.from('trips').delete().eq('id', tripId)
          if (error) { await refresh(); throw error }
        }
      }),

      invite: email => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) {
          const trip = mapTrip(localStore.invite(activeTrip.id, email))
          updateActive(() => trip)
        }
        else {
          const temporaryId = optimisticId()
          const optimistic = { id:temporaryId, email:email.toLowerCase(), role:'editor', status:'pending' }
          updateActive(trip => ({ ...trip, invitations:[...trip.invitations.filter(item => item.email !== optimistic.email), optimistic] }))
          const { data, error } = await supabase.functions.invoke('invite-member', { body:{ tripId:activeTrip.id, email } })
          if (error || data?.error) { await refresh(); throw error || new Error(data.error) }
          updateActive(trip => ({ ...trip, invitations:trip.invitations.map(item => item.id === temporaryId ? data.invite : item) }))
          toast('Invitación creada', 'success')
          return data
        }
        toast('Invitación enviada', 'success')
      }),

      revokeInvite: invitationId => run(async () => {
        if (!activeTrip) return
        updateActive(trip => ({ ...trip, invitations:trip.invitations.filter(item => item.id !== invitationId) }))
        if (!hasSupabase) localStore.revokeInvite(activeTrip.id, invitationId)
        else {
          const { error } = await supabase.from('trip_invitations').delete().eq('id', invitationId)
          if (error) { await refresh(); throw error }
        }
      }),

      addDay: values => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) {
          const trip = mapTrip(localStore.addDay(activeTrip.id, values))
          updateActive(() => trip)
        }
        else {
          const temporaryId = optimisticId()
          const optimistic = {
            id:temporaryId,
            trip_id:activeTrip.id,
            position:nextPos(activeTrip.days),
            date:values.date || '',
            city:values.city,
            title:values.title || `Día en ${values.city}`,
            subtitle:'',
            activities:[]
          }
          updateActive(trip => ({ ...trip, days:[...trip.days, optimistic].sort(byPosition) }))
          const { data, error } = await supabase.from('days').insert({
            trip_id:activeTrip.id,
            position:optimistic.position,
            date:values.date || null,
            city:values.city,
            title:values.title || `Día en ${values.city}`
          }).select('*').single()
          if (error) { await refresh(); throw error }
          updateActive(trip => ({ ...trip, days:trip.days.map(day => day.id === temporaryId ? { ...data, activities:[] } : day).sort(byPosition) }))
        }
      }),

      deleteDay: dayId => run(async () => {
        if (!activeTrip) return
        const removed = activeTrip.days.find(day => day.id === dayId)
        updateActive(trip => ({ ...trip, days:trip.days.filter(day => day.id !== dayId) }))
        if (!hasSupabase) localStore.deleteDay(activeTrip.id, dayId)
        else {
          const { error } = await supabase.from('days').delete().eq('id', dayId)
          if (error) { await refresh(); throw error }
        }
        toast('Eliminado', { type:'success', action:{ label:'Deshacer', onClick:async () => {
          if (!removed) return
          if (!hasSupabase) localStore.restoreDay(activeTrip.id, removed)
          else {
            const { data:day, error } = await supabase.from('days').insert({
              trip_id:activeTrip.id, position:removed.position, date:removed.date || null,
              city:removed.city, title:removed.title, subtitle:removed.subtitle || ''
            }).select('id').single()
            if (error) return toast(error.message)
            if (removed.activities.length) await supabase.from('activities').insert(removed.activities.map(activity => ({
              trip_id:activeTrip.id, day_id:day.id, position:activity.position, name:activity.name,
              time:activity.time || null, duration:activity.duration || '', category:activity.category,
              address:activity.address, latitude:activity.latitude, longitude:activity.longitude,
              price_label:activity.priceLabel, done:activity.done,
              tripadvisor_location_id:activity.tripadvisorLocationId || null
            })))
          }
          await refresh()
        } } })
      }),

      updateDay: (dayId, fields) => run(async () => {
        if (!activeTrip) return
        updateActive(trip => ({ ...trip, days:trip.days.map(day => day.id === dayId ? { ...day, ...fields } : day) }))
        if (!hasSupabase) localStore.updateDay(activeTrip.id, dayId, fields)
        else {
          const payload = {}
          for (const key of ['city', 'title', 'subtitle', 'date']) {
            if (fields[key] !== undefined) payload[key] = fields[key] || null
          }
          const { error } = await supabase.from('days').update(payload).eq('id', dayId)
          if (error) { await refresh(); throw error }
        }
      }),

      reorderDays: (firstId, secondId) => run(async () => {
        if (!activeTrip) return
        const first = activeTrip.days.find(day => day.id === firstId)
        const second = activeTrip.days.find(day => day.id === secondId)
        if (!first || !second) return
        updateActive(trip => ({
          ...trip,
          days:trip.days.map(day => {
            if (day.id === firstId) return { ...day, position:second.position, day:second.position }
            if (day.id === secondId) return { ...day, position:first.position, day:first.position }
            return day
          }).sort(byPosition)
        }))
        if (!hasSupabase) localStore.reorderDays(activeTrip.id, firstId, secondId)
        else {
          const temporary = -Math.max(first.position, second.position, 1)
          let result = await supabase.from('days').update({ position:temporary }).eq('id', first.id)
          if (result.error) { await refresh(); throw result.error }
          result = await supabase.from('days').update({ position:first.position }).eq('id', second.id)
          if (result.error) { await refresh(); throw result.error }
          result = await supabase.from('days').update({ position:second.position }).eq('id', first.id)
          if (result.error) { await refresh(); throw result.error }
        }
      }),

      addActivity: (dayId, values) => run(async () => {
        if (!activeTrip) return
        const day = activeTrip.days.find(item => item.id === dayId)
        let latitude = values.latitude ?? null
        let longitude = values.longitude ?? null
        if (latitude == null && values.address) {
          try {
            const point = await geocodeQuery([values.address, day?.city].filter(Boolean).join(', '))
            if (point) { latitude = point.lat; longitude = point.lon }
          } catch { /* mejor sin coordenadas que bloquear el alta */ }
        }
        const expense = values.expense && Number(values.expense.amount) > 0 ? values.expense : null
        const expenseAmount = expense ? Number(expense.amount) : (Number(values.expenseAmount) || 0)
        const expenseCurrency = expense ? (expense.currency || activeTrip.currency) : (values.expenseCurrency || '')
        if (!hasSupabase) {
          const tripData = localStore.addActivity(activeTrip.id, dayId, { ...values, latitude, longitude, expenseAmount, expenseCurrency })
          const trip = mapTrip(tripData)
          const created = trip.days.find(item => item.id === dayId)?.activities.slice(-1)[0]
          if (expense && created) {
            const linked = mapTrip(localStore.addExpense(activeTrip.id, {
              description:values.name, amount:Number(expense.amount), currency:expenseCurrency,
              category:expenseCategoryFor(values.category), date:day?.date || '',
              paidBy:expense.paidBy || user.id, split:expense.split || {}, activityId:created.id
            }))
            updateActive(() => linked)
          } else {
            updateActive(() => trip)
          }
        }
        else {
          const temporaryId = optimisticId()
          const optimistic = {
            id:temporaryId,
            dayId,
            position:nextPos(day?.activities),
            name:values.name,
            time:values.time || '',
            duration:values.duration || '',
            address:values.address || '',
            category:values.category || 'entertainment',
            priceLabel:values.priceLabel || '',
            expenseAmount,
            expenseCurrency,
            latitude,
            longitude,
            tripadvisorLocationId:values.tripadvisorLocationId || '',
            done:false
          }
          updateActive(trip => ({ ...trip, days:trip.days.map(item => item.id === dayId ? { ...item, activities:[...item.activities, optimistic].sort(byPosition) } : item) }))
          const { data, error } = await supabase.from('activities').insert({
            trip_id:activeTrip.id,
            day_id:dayId,
            position:optimistic.position,
            name:values.name,
            time:values.time || null,
            duration:values.duration || '',
            address:values.address || '',
            category:values.category || 'entertainment',
            price_label:values.priceLabel || '',
            expense_amount:expenseAmount || null,
            expense_currency:expenseCurrency,
            latitude,
            longitude,
            tripadvisor_location_id:values.tripadvisorLocationId || null
          }).select('*').single()
          if (error) { await refresh(); throw error }
          updateActive(trip => ({ ...trip, days:trip.days.map(item => item.id === dayId ? { ...item, activities:item.activities.map(activity => activity.id === temporaryId ? mapActivity(data) : activity).sort(byPosition) } : item) }))
          if (expense) {
            const { data:expData, error:expError } = await supabase.from('expenses').insert({
              trip_id:activeTrip.id, description:values.name, amount:Number(expense.amount),
              currency:expenseCurrency, category:expenseCategoryFor(values.category), date:day?.date || null,
              paid_by:expense.paidBy || user.id, split:expense.split || {}, activity_id:data.id
            }).select('*').single()
            if (!expError && expData) {
              const saved = mapTrip({ ...activeTrip, expenses:[expData] }).expenses[0]
              updateActive(trip => ({ ...trip, expenses:[...trip.expenses, saved] }))
            }
          }
        }
        toast('Agregado a la ruta', 'success')
      }),

      updateActivity: (dayId, activityId, fields) => run(async () => {
        if (!activeTrip) return
        updateActive(trip => ({ ...trip, days:trip.days.map(day => day.id === dayId ? { ...day, activities:day.activities.map(activity => activity.id === activityId ? { ...activity, ...fields } : activity) } : day) }))
        if (!hasSupabase) localStore.updateActivity(activeTrip.id, dayId, activityId, fields)
        else {
          const payload = {}
          if (fields.name !== undefined) payload.name = fields.name
          if (fields.time !== undefined) payload.time = fields.time || null
          if (fields.duration !== undefined) payload.duration = fields.duration || ''
          if (fields.address !== undefined) payload.address = fields.address || ''
          if (fields.category !== undefined) payload.category = fields.category
          if (fields.priceLabel !== undefined) payload.price_label = fields.priceLabel || ''
          if (fields.expenseAmount !== undefined) payload.expense_amount = Number(fields.expenseAmount) || null
          if (fields.expenseCurrency !== undefined) payload.expense_currency = fields.expenseCurrency || ''
          if (fields.latitude !== undefined) payload.latitude = fields.latitude
          if (fields.longitude !== undefined) payload.longitude = fields.longitude
          if (fields.tripadvisorLocationId !== undefined) payload.tripadvisor_location_id = fields.tripadvisorLocationId || null
          const { error } = await supabase.from('activities').update(payload).eq('id', activityId)
          if (error) { await refresh(); throw error }
        }
      }),

      reorderActivities: (dayId, firstId, secondId) => run(async () => {
        if (!activeTrip) return
        const day = activeTrip.days.find(item => item.id === dayId)
        const first = day?.activities.find(item => item.id === firstId)
        const second = day?.activities.find(item => item.id === secondId)
        if (!first || !second) return
        updateActive(trip => ({
          ...trip,
          days:trip.days.map(item => item.id === dayId ? {
            ...item,
            activities:item.activities.map(activity => {
              if (activity.id === firstId) return { ...activity, position:second.position }
              if (activity.id === secondId) return { ...activity, position:first.position }
              return activity
            }).sort(byPosition)
          } : item)
        }))
        if (!hasSupabase) localStore.reorderActivities(activeTrip.id, dayId, firstId, secondId)
        else {
          const temporary = -Math.max(first.position, second.position, 1)
          let result = await supabase.from('activities').update({ position:temporary }).eq('id', first.id)
          if (result.error) { await refresh(); throw result.error }
          result = await supabase.from('activities').update({ position:first.position }).eq('id', second.id)
          if (result.error) { await refresh(); throw result.error }
          result = await supabase.from('activities').update({ position:second.position }).eq('id', first.id)
          if (result.error) { await refresh(); throw result.error }
        }
      }),

      toggleActivityDone: (dayId, activityId) => run(async () => {
        if (!activeTrip) return
        const activity = activeTrip.days.find(day => day.id === dayId)?.activities.find(item => item.id === activityId)
        updateActive(trip => ({ ...trip, days:trip.days.map(day => day.id === dayId ? { ...day, activities:day.activities.map(item => item.id === activityId ? { ...item, done:!item.done } : item) } : day) }))
        if (!hasSupabase) localStore.toggleActivityDone(activeTrip.id, dayId, activityId)
        else {
          const { error } = await supabase.from('activities').update({ done:!activity?.done }).eq('id', activityId)
          if (error) { await refresh(); throw error }
        }
      }),

      // options: { seed, latitude, longitude, radiusKm, limit } — seed indica una
      // búsqueda de sugerencias (sin texto del usuario); en modo local devuelve
      // todas las ideas en vez de filtrar por coincidencia literal.
      searchPlaces: async (query, city, category, options = {}) => {
        // Autocompletado y picker: falla en silencio para no llenar de toasts mientras se tipea.
        try {
          if (!hasSupabase) {
            const text = (query || '').toLowerCase()
            const places = localStore.placeSuggestions(city, category)
            return {
              provider:'Ruta26 local',
              places:options.seed ? places : places.filter(place => place.name.toLowerCase().includes(text)),
              externalContent:false
            }
          }
          const providerCategory = category === 'food' ? 'restaurants' : category === 'hotel' || category === 'hotels' ? 'hotels' : 'attractions'
          const hasGeo = options.latitude != null && options.longitude != null
          const geoKey = hasGeo ? `${options.latitude.toFixed(2)},${options.longitude.toFixed(2)},${Math.round(options.radiusKm || 0)}` : ''
          const limit = options.limit || 5
          const cacheKey = placeCacheKey(['search', query, city, providerCategory, geoKey, limit])
          const cached = readPlaceCache(cacheKey)
          if (cached) return cached
          const { data, error } = await supabase.functions.invoke('travel-search', {
            body:{
              query,
              city,
              category:providerCategory,
              currency:activeTrip?.currency,
              language:'es',
              limit,
              latitude:hasGeo ? options.latitude : undefined,
              longitude:hasGeo ? options.longitude : undefined,
              radiusKm:hasGeo ? options.radiusKm : undefined
            }
          })
          if (error) {
            const payload = await error.context?.json?.().catch(() => null)
            if (payload?.limitReached) toast(payload.error)
            return null
          }
          if (data?.error) return null
          writePlaceCache(cacheKey, data)
          return data
        } catch {
          return null
        }
      },

      // Browse por área sin texto (mapa del picker). fallbackQuery cubre el caso
      // de una edge function desplegada sin la acción 'nearby' todavía.
      searchNearbyPlaces: async ({ latitude, longitude, radiusKm, category, city, fallbackQuery, limit = 8 }) => {
        try {
          if (!hasSupabase) {
            return {
              provider:'Ruta26 local',
              places:localStore.placeSuggestions(city, category),
              externalContent:false
            }
          }
          const providerCategory = category === 'food' ? 'restaurants' : 'attractions'
          const cacheKey = placeCacheKey(['nearby', providerCategory, `${latitude.toFixed(2)},${longitude.toFixed(2)}`, Math.round(radiusKm || 0), limit])
          const cached = readPlaceCache(cacheKey)
          if (cached) return cached
          let { data, error } = await supabase.functions.invoke('travel-search', {
            body:{ action:'nearby', latitude, longitude, radiusKm, category:providerCategory, currency:activeTrip?.currency, language:'es', limit }
          })
          if (error) {
            const payload = await error.context?.json?.().catch(() => null)
            if (payload?.limitReached) toast(payload.error)
            return null
          }
          // Solo reintentamos con búsqueda por texto si la edge function aún no
          // soporta 'nearby' (responde "query es requerido"). Nunca ante cuota
          // agotada (429) ni otros errores: sería doble gasto de cuota.
          const needsFallback = fallbackQuery && data?.error === 'query es requerido'
          if (needsFallback) {
            ;({ data, error } = await supabase.functions.invoke('travel-search', {
              body:{ query:fallbackQuery, category:providerCategory, latitude, longitude, radiusKm, currency:activeTrip?.currency, language:'es', limit }
            }))
          }
          if (error) {
            const payload = await error.context?.json?.().catch(() => null)
            if (payload?.limitReached) toast(payload.error)
            return null
          }
          if (data?.error) return null
          writePlaceCache(cacheKey, data)
          return data
        } catch {
          return null
        }
      },

      // Foto del lugar bajo demanda (1 unidad de cuota Tripadvisor). Cachea
      // incluso el "sin foto" para no reintentar, y falla en silencio: el picker
      // muestra un placeholder de categoría si no hay url.
      fetchPlacePhoto: async locationId => {
        if (!locationId || String(locationId).startsWith('local-') || !hasSupabase) return ''
        try {
          const cacheKey = placeCacheKey(['photo', locationId])
          const cached = readPlaceCache(cacheKey)
          if (cached) return cached.url || ''
          const { data, error } = await supabase.functions.invoke('travel-search', {
            body:{ action:'photos', locationId, language:'es' }
          })
          if (error || data?.error) { writePlaceCache(cacheKey, { url:'' }); return '' }
          const url = data?.photo?.url || ''
          writePlaceCache(cacheKey, { url })
          return url
        } catch {
          return ''
        }
      },

      deleteActivity: (dayId, activityId) => run(async () => {
        if (!activeTrip) return
        const removed = activeTrip.days.find(day => day.id === dayId)?.activities.find(item => item.id === activityId)
        updateActive(trip => ({ ...trip, days:trip.days.map(day => day.id === dayId ? { ...day, activities:day.activities.filter(item => item.id !== activityId) } : day) }))
        if (!hasSupabase) localStore.deleteActivity(activeTrip.id, dayId, activityId)
        else {
          const { error } = await supabase.from('activities').delete().eq('id', activityId)
          if (error) { await refresh(); throw error }
        }
        toast('Eliminado', { type:'success', action:{ label:'Deshacer', onClick:async () => {
          if (!removed) return
          if (!hasSupabase) localStore.restoreActivity(activeTrip.id, dayId, removed)
          else await supabase.from('activities').insert({
            trip_id:activeTrip.id, day_id:dayId, position:removed.position, name:removed.name,
            time:removed.time || null, duration:removed.duration || '', category:removed.category,
            address:removed.address, latitude:removed.latitude, longitude:removed.longitude,
            price_label:removed.priceLabel, done:removed.done,
            tripadvisor_location_id:removed.tripadvisorLocationId || null
          })
          await refresh()
        } } })
      }),

      addHotel: values => run(async () => {
        if (!activeTrip) return
        const cost = Number(values.cost) || null
        const costCurrency = values.costCurrency || (cost ? activeTrip.currency : '')
        const expense = values.expense && cost ? values.expense : null
        if (!hasSupabase) {
          const tripData = localStore.addHotel(activeTrip.id, { ...values, cost, costCurrency })
          const trip = mapTrip(tripData)
          const created = trip.hotels.slice(-1)[0]
          if (expense && created) {
            const linked = mapTrip(localStore.addExpense(activeTrip.id, {
              description:values.name, amount:cost, currency:costCurrency, category:'hotel',
              date:values.checkIn || '', paidBy:expense.paidBy || user.id, split:expense.split || {}, hotelId:created.id
            }))
            updateActive(() => linked)
          } else {
            updateActive(() => trip)
          }
        }
        else {
          const temporaryId = optimisticId()
          const optimistic = {
            id:temporaryId,
            city:values.city,
            name:values.name,
            address:values.address || '',
            checkIn:values.checkIn || '',
            checkOut:values.checkOut || '',
            latitude:values.latitude ?? null,
            longitude:values.longitude ?? null,
            cost,
            costCurrency
          }
          updateActive(trip => ({ ...trip, hotels:[...trip.hotels, optimistic] }))
          const { data, error } = await supabase.from('hotels').insert({
            trip_id:activeTrip.id,
            city:values.city,
            name:values.name,
            address:values.address || '',
            check_in:values.checkIn || null,
            check_out:values.checkOut || null,
            latitude:values.latitude ?? null,
            longitude:values.longitude ?? null,
            cost,
            cost_currency:costCurrency
          }).select('*').single()
          if (error) { await refresh(); throw error }
          const saved = mapTrip({ ...activeTrip, hotels:[data] }).hotels[0]
          updateActive(trip => ({ ...trip, hotels:trip.hotels.map(hotel => hotel.id === temporaryId ? saved : hotel) }))
          if (expense) {
            const { data:expData, error:expError } = await supabase.from('expenses').insert({
              trip_id:activeTrip.id, description:values.name, amount:cost, currency:costCurrency,
              category:'hotel', date:values.checkIn || null, paid_by:expense.paidBy || user.id,
              split:expense.split || {}, hotel_id:data.id
            }).select('*').single()
            if (!expError && expData) {
              const savedExp = mapTrip({ ...activeTrip, expenses:[expData] }).expenses[0]
              updateActive(trip => ({ ...trip, expenses:[...trip.expenses, savedExp] }))
            }
          }
        }
      }),

      deleteHotel: hotelId => run(async () => {
        if (!activeTrip) return
        const removed = activeTrip.hotels.find(item => item.id === hotelId)
        updateActive(trip => ({ ...trip, hotels:trip.hotels.filter(item => item.id !== hotelId) }))
        if (!hasSupabase) localStore.deleteHotel(activeTrip.id, hotelId)
        else {
          const { error } = await supabase.from('hotels').delete().eq('id', hotelId)
          if (error) { await refresh(); throw error }
        }
        toast('Eliminado', { type:'success', action:{ label:'Deshacer', onClick:async () => {
          if (!removed) return
          if (!hasSupabase) localStore.restoreHotel(activeTrip.id, removed)
          else await supabase.from('hotels').insert({ trip_id:activeTrip.id, city:removed.city, name:removed.name, address:removed.address, check_in:removed.checkIn || null, check_out:removed.checkOut || null })
          await refresh()
        } } })
      }),

      addExpense: values => run(async () => {
        if (!activeTrip) return
        const expenseValues = { ...values, paidBy:values.paidBy || user.id, split:values.split || {} }
        if (!hasSupabase) {
          const trip = mapTrip(localStore.addExpense(activeTrip.id, expenseValues))
          updateActive(() => trip)
        }
        else {
          const temporaryId = optimisticId()
          const optimistic = {
            id:temporaryId,
            description:values.description,
            amount:Number(values.amount),
            currency:values.currency || activeTrip.currency,
            category:values.category || 'activity',
            date:values.date || '',
            paidBy:expenseValues.paidBy,
            activityId:values.activityId || null,
            hotelId:values.hotelId || null,
            isSettlement:!!values.isSettlement,
            split:expenseValues.split
          }
          updateActive(trip => ({ ...trip, expenses:[...trip.expenses, optimistic] }))
          const { data, error } = await supabase.from('expenses').insert({
            trip_id:activeTrip.id,
            description:values.description,
            amount:Number(values.amount),
            currency:values.currency || activeTrip.currency,
            category:values.category || 'activity',
            date:values.date || null,
            paid_by:expenseValues.paidBy,
            activity_id:values.activityId || null,
            hotel_id:values.hotelId || null,
            is_settlement:!!values.isSettlement,
            split:expenseValues.split
          }).select('*').single()
          if (error) { await refresh(); throw error }
          const saved = mapTrip({ ...activeTrip, expenses:[data] }).expenses[0]
          updateActive(trip => ({ ...trip, expenses:trip.expenses.map(expense => expense.id === temporaryId ? saved : expense) }))
        }
      }),

      updateExpense: (expenseId, fields) => run(async () => {
        if (!activeTrip) return
        updateActive(trip => ({ ...trip, expenses:trip.expenses.map(expense => expense.id === expenseId ? { ...expense, ...fields } : expense) }))
        if (!hasSupabase) localStore.updateExpense(activeTrip.id, expenseId, fields)
        else {
          const payload = {}
          if (fields.description !== undefined) payload.description = fields.description
          if (fields.amount !== undefined) payload.amount = Number(fields.amount)
          if (fields.currency !== undefined) payload.currency = fields.currency
          if (fields.category !== undefined) payload.category = fields.category
          if (fields.date !== undefined) payload.date = fields.date || null
          if (fields.paidBy !== undefined) payload.paid_by = fields.paidBy
          if (fields.split !== undefined) payload.split = fields.split
          if (fields.isSettlement !== undefined) payload.is_settlement = !!fields.isSettlement
          const { error } = await supabase.from('expenses').update(payload).eq('id', expenseId)
          if (error) { await refresh(); throw error }
        }
        toast('Gasto actualizado', 'success')
      }),

      deleteExpense: expenseId => run(async () => {
        if (!activeTrip) return
        const removed = activeTrip.expenses.find(item => item.id === expenseId)
        updateActive(trip => ({ ...trip, expenses:trip.expenses.filter(item => item.id !== expenseId) }))
        if (!hasSupabase) localStore.deleteExpense(activeTrip.id, expenseId)
        else {
          const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
          if (error) { await refresh(); throw error }
        }
        toast('Eliminado', { type:'success', action:{ label:'Deshacer', onClick:async () => {
          if (!removed) return
          if (!hasSupabase) localStore.restoreExpense(activeTrip.id, removed)
          else await supabase.from('expenses').insert({ trip_id:activeTrip.id, description:removed.description, amount:removed.amount, currency:removed.currency, category:removed.category, date:removed.date || null, paid_by:removed.paidBy, activity_id:removed.activityId || null, hotel_id:removed.hotelId || null, is_settlement:!!removed.isSettlement, split:removed.split || {} })
          await refresh()
        } } })
      }),

      addPackingItem: item => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) {
          const trip = mapTrip(localStore.addPackingItem(activeTrip.id, item))
          updateActive(() => trip)
        }
        else {
          const temporaryId = optimisticId()
          updateActive(trip => ({ ...trip, packingItems:[...trip.packingItems, { id:temporaryId, item, packed:false }] }))
          const { data, error } = await supabase.from('packing_items').insert({ trip_id:activeTrip.id, item }).select('*').single()
          if (error) { await refresh(); throw error }
          updateActive(trip => ({ ...trip, packingItems:trip.packingItems.map(entry => entry.id === temporaryId ? { id:data.id, item:data.item, packed:!!data.packed } : entry) }))
        }
      }),

      addPackingItems: items => run(async () => {
        if (!activeTrip || !items.length) return
        if (!hasSupabase) {
          const trip = mapTrip(localStore.addPackingItems(activeTrip.id, items))
          updateActive(() => trip)
        }
        else {
          const optimistic = items.map(item => ({ id:optimisticId(), item, packed:false }))
          updateActive(trip => ({ ...trip, packingItems:[...trip.packingItems, ...optimistic] }))
          const { data, error } = await supabase.from('packing_items').insert(items.map(item => ({ trip_id:activeTrip.id, item }))).select('*')
          if (error) { await refresh(); throw error }
          const replacements = new Map(optimistic.map((entry, index) => [entry.id, data[index]]))
          updateActive(trip => ({ ...trip, packingItems:trip.packingItems.map(entry => {
            const saved = replacements.get(entry.id)
            return saved ? { id:saved.id, item:saved.item, packed:!!saved.packed } : entry
          }) }))
        }
      }),

      togglePackingItem: itemId => run(async () => {
        if (!activeTrip) return
        updateActive(trip => ({ ...trip, packingItems:trip.packingItems.map(item => item.id === itemId ? { ...item, packed:!item.packed } : item) }))
        if (!hasSupabase) localStore.togglePackingItem(activeTrip.id, itemId)
        else {
          const entry = activeTrip.packingItems.find(item => item.id === itemId)
          const { error } = await supabase.from('packing_items').update({ packed:!entry?.packed }).eq('id', itemId)
          if (error) { await refresh(); throw error }
        }
      }),

      deletePackingItem: itemId => run(async () => {
        if (!activeTrip) return
        const removed = activeTrip.packingItems.find(item => item.id === itemId)
        updateActive(trip => ({ ...trip, packingItems:trip.packingItems.filter(item => item.id !== itemId) }))
        if (!hasSupabase) localStore.deletePackingItem(activeTrip.id, itemId)
        else {
          const { error } = await supabase.from('packing_items').delete().eq('id', itemId)
          if (error) { await refresh(); throw error }
        }
        toast('Eliminado', { type:'success', action:{ label:'Deshacer', onClick:async () => {
          if (!removed) return
          if (!hasSupabase) localStore.restorePackingItem(activeTrip.id, removed)
          else await supabase.from('packing_items').insert({ trip_id:activeTrip.id, item:removed.item, category:removed.category || 'essential', packed:removed.packed })
          await refresh()
        } } })
      }),

      loadChat: () => run(async () => {
        if (!activeTrip) return []
        if (!hasSupabase) return localStore.chat(activeTrip.id)
        const { data, error } = await supabase
          .from('assistant_messages')
          .select('role,content')
          .eq('trip_id', activeTrip.id)
          .order('created_at')
        if (error) {
          const payload = await error.context?.json?.().catch(() => null)
          if (payload?.limitReached) return payload
          throw error
        }
        return data
      }),

      clearChat: () => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) { localStore.clearChat(activeTrip.id); return }
        const { error } = await supabase.from('assistant_messages').delete().eq('trip_id', activeTrip.id)
        if (error) throw error
      }),

      askAssistant: (prompt, history = []) => run(async () => {
        if (!activeTrip) return null
        if (!hasSupabase) {
          const text = localStore.assistantReply(activeTrip.id, prompt)
          localStore.appendChat(activeTrip.id, [{ role:'user', content:prompt }, { role:'assistant', content:text }])
          return { text, changed:false }
        }
        const recentHistory = history.slice(-19)
        const messages = recentHistory
          .filter(message => ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
          .map(message => ({ role:message.role, content:message.content }))
        const { data, error } = await supabase.functions.invoke('trip-assistant', {
          body:{
            tripId:activeTrip.id,
            messages:[...messages, { role:'user', content:prompt }],
            externalContentInHistory:recentHistory.some(message => message.externalContent)
          }
        })
        if (error) throw error
        if (data?.error) throw new Error(data.error)
        if (!data.externalContent) {
          const { error: saveError } = await supabase.from('assistant_messages').insert([
            { trip_id:activeTrip.id, user_id:user.id, role:'user', content:prompt },
            { trip_id:activeTrip.id, user_id:user.id, role:'assistant', content:data.text }
          ])
          if (saveError) throw saveError
        }
        if (data.changed) await refresh()
        return data
      })
    })
  }, [trips, activeTrip, activeTripId, loading, offline, refresh, user, toast])

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export const useTrips = () => useContext(TripContext)
