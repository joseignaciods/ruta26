import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { hasSupabase, supabase } from '../lib/supabase.js'
import { localStore } from '../lib/localStore.js'
import { geocodeQuery } from '../lib/geo.js'
import { useAuth } from './AuthContext.jsx'
import { useToast } from './ToastContext.jsx'

const TripContext = createContext(null)

const byPosition = (a, b) => (a.position || a.day || 0) - (b.position || b.day || 0)
const nextPos = list => (list || []).reduce((max, item) => Math.max(max, item.position || item.day || 0), 0) + 1

const mapActivity = row => ({
  id:row.id,
  dayId:row.day_id ?? row.dayId,
  position:row.position,
  name:row.name,
  time:row.time || '',
  address:row.address || '',
  category:row.category || 'entertainment',
  priceLabel:row.price_label ?? row.priceLabel ?? '',
  expenseAmount:Number(row.expense_amount ?? row.expenseAmount ?? 0),
  expenseCurrency:row.expense_currency ?? row.expenseCurrency ?? '',
  latitude:row.latitude ?? null,
  longitude:row.longitude ?? null,
  tripadvisorLocationId:row.tripadvisor_location_id ?? row.tripadvisorLocationId ?? ''
})

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
    longitude:hotel.longitude ?? null
  })),
  expenses:(row.expenses || []).map(expense => ({
    id:expense.id,
    description:expense.description,
    amount:Number(expense.amount || 0),
    currency:expense.currency,
    category:expense.category || 'activity',
    date:expense.date || '',
    paidBy:expense.paid_by ?? expense.paidBy ?? null
  })),
  packingItems:(row.packing_items || row.packingItems || []).map(item => ({ id:item.id, item:item.item, packed:!!item.packed }))
})

export function TripProvider({ children }) {
  const { user } = useAuth()
  const toast = useToast()
  const [trips, setTrips] = useState([])
  const [activeTripId, setActiveTripId] = useState(localStorage.getItem('ruta26_active_trip'))
  const [loading, setLoading] = useState(false)

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
        setTrips(data.map(row => mapTrip(row, profiles)))
      }
    } catch (error) {
      toast(error.message || 'No se pudieron cargar los viajes')
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
    const run = async fn => {
      try { return await fn() } catch (error) { toast(error.message || 'Error inesperado'); return null }
    }

    return ({
      trips, activeTrip, activeTripId, loading, setActiveTripId, refresh,

      createTrip: values => run(async () => {
        let trip
        if (!hasSupabase) {
          trip = localStore.createTrip(user, values)
        } else {
          const { data, error } = await supabase.rpc('create_trip', {
            p_name:values.name,
            p_start_date:values.startDate || null,
            p_end_date:values.endDate || null,
            p_currency:values.currency || 'USD',
            p_timezone:values.timezone || 'America/Santiago'
          })
          if (error) throw error
          trip = { id:data }
        }
        await refresh()
        setActiveTripId(trip.id)
        return trip
      }),

      createEuropeDemo: () => run(async () => {
        if (hasSupabase) throw new Error('La demo automática está disponible solo en modo local')
        const trip = localStore.createEuropeDemo(user)
        await refresh()
        setActiveTripId(trip.id)
        return trip
      }),

      updateTrip: updates => run(async () => {
        if (!activeTrip) return
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
          if (error) throw error
        }
        await refresh()
        toast('Viaje actualizado', 'success')
      }),

      invite: email => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.invite(activeTrip.id, email)
        else {
          const { error } = await supabase.functions.invoke('invite-member', { body:{ tripId:activeTrip.id, email } })
          if (error) throw error
        }
        await refresh()
        toast('Invitación enviada', 'success')
      }),

      revokeInvite: invitationId => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.revokeInvite(activeTrip.id, invitationId)
        else {
          const { error } = await supabase.from('trip_invitations').delete().eq('id', invitationId)
          if (error) throw error
        }
        await refresh()
      }),

      addDay: values => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.addDay(activeTrip.id, values)
        else {
          const { error } = await supabase.from('days').insert({
            trip_id:activeTrip.id,
            position:nextPos(activeTrip.days),
            date:values.date || null,
            city:values.city,
            title:values.title || `Día en ${values.city}`
          })
          if (error) throw error
        }
        await refresh()
      }),

      deleteDay: dayId => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.deleteDay(activeTrip.id, dayId)
        else {
          const { error } = await supabase.from('days').delete().eq('id', dayId)
          if (error) throw error
        }
        await refresh()
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
        if (!hasSupabase) localStore.addActivity(activeTrip.id, dayId, { ...values, latitude, longitude })
        else {
          const { error } = await supabase.from('activities').insert({
            trip_id:activeTrip.id,
            day_id:dayId,
            position:nextPos(day?.activities),
            name:values.name,
            time:values.time || null,
            address:values.address || '',
            category:values.category || 'entertainment',
            price_label:values.priceLabel || '',
            latitude,
            longitude,
            tripadvisor_location_id:values.tripadvisorLocationId || null
          })
          if (error) throw error
        }
        await refresh()
      }),

      updateActivity: (dayId, activityId, fields) => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.updateActivity(activeTrip.id, dayId, activityId, fields)
        else {
          const payload = {}
          if (fields.name !== undefined) payload.name = fields.name
          if (fields.time !== undefined) payload.time = fields.time || null
          if (fields.address !== undefined) payload.address = fields.address || ''
          if (fields.category !== undefined) payload.category = fields.category
          if (fields.priceLabel !== undefined) payload.price_label = fields.priceLabel || ''
          if (fields.latitude !== undefined) payload.latitude = fields.latitude
          if (fields.longitude !== undefined) payload.longitude = fields.longitude
          if (fields.tripadvisorLocationId !== undefined) payload.tripadvisor_location_id = fields.tripadvisorLocationId || null
          const { error } = await supabase.from('activities').update(payload).eq('id', activityId)
          if (error) throw error
        }
        await refresh()
      }),

      searchPlaces: async (query, city, category) => {
        // Autocompletado: falla en silencio para no llenar de toasts mientras se tipea.
        try {
          if (!hasSupabase) {
            const text = query.toLowerCase()
            return {
              provider:'Ruta26 local',
              places:localStore.placeSuggestions(city, category).filter(place => place.name.toLowerCase().includes(text)),
              externalContent:false
            }
          }
          const providerCategory = category === 'food' ? 'restaurants' : 'attractions'
          const { data, error } = await supabase.functions.invoke('travel-search', {
            body:{ query, city, category:providerCategory, currency:activeTrip?.currency, language:'es', limit:5 }
          })
          if (error || data?.error) return null
          return data
        } catch {
          return null
        }
      },

      discoverPlaces: (city, category) => run(async () => {
        if (!hasSupabase) {
          return {
            provider:'Ruta26 local',
            places:localStore.placeSuggestions(city, category),
            externalContent:false
          }
        }
        const providerCategory = category === 'food' ? 'restaurants' : 'attractions'
        const queries = {
          culture:'museos, historia y lugares culturales',
          food:'restaurantes y comida local',
          nature:'parques, jardines y naturaleza',
          entertainment:'tours, espectáculos y experiencias',
          transport:'estaciones y transporte'
        }
        const { data, error } = await supabase.functions.invoke('travel-search', {
          body:{
            query:queries[category] || 'lugares recomendados',
            city,
            category:providerCategory,
            currency:activeTrip.currency,
            language:'es',
            limit:5
          }
        })
        if (error) throw error
        if (data?.error) throw new Error(data.error)
        return data
      }),

      deleteActivity: (dayId, activityId) => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.deleteActivity(activeTrip.id, dayId, activityId)
        else {
          const { error } = await supabase.from('activities').delete().eq('id', activityId)
          if (error) throw error
        }
        await refresh()
      }),

      addHotel: values => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.addHotel(activeTrip.id, values)
        else {
          const { error } = await supabase.from('hotels').insert({
            trip_id:activeTrip.id,
            city:values.city,
            name:values.name,
            address:values.address || '',
            check_in:values.checkIn || null,
            check_out:values.checkOut || null
          })
          if (error) throw error
        }
        await refresh()
      }),

      deleteHotel: hotelId => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.deleteHotel(activeTrip.id, hotelId)
        else {
          const { error } = await supabase.from('hotels').delete().eq('id', hotelId)
          if (error) throw error
        }
        await refresh()
      }),

      addExpense: values => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.addExpense(activeTrip.id, { ...values, paidBy:values.paidBy || user.id })
        else {
          const { error } = await supabase.from('expenses').insert({
            trip_id:activeTrip.id,
            description:values.description,
            amount:Number(values.amount),
            currency:values.currency || activeTrip.currency,
            category:values.category || 'activity',
            date:values.date || null,
            paid_by:values.paidBy || user.id
          })
          if (error) throw error
        }
        await refresh()
      }),

      deleteExpense: expenseId => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.deleteExpense(activeTrip.id, expenseId)
        else {
          const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
          if (error) throw error
        }
        await refresh()
      }),

      addPackingItem: item => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.addPackingItem(activeTrip.id, item)
        else {
          const { error } = await supabase.from('packing_items').insert({ trip_id:activeTrip.id, item })
          if (error) throw error
        }
        await refresh()
      }),

      togglePackingItem: itemId => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.togglePackingItem(activeTrip.id, itemId)
        else {
          const entry = activeTrip.packingItems.find(item => item.id === itemId)
          const { error } = await supabase.from('packing_items').update({ packed:!entry?.packed }).eq('id', itemId)
          if (error) throw error
        }
        await refresh()
      }),

      deletePackingItem: itemId => run(async () => {
        if (!activeTrip) return
        if (!hasSupabase) localStore.deletePackingItem(activeTrip.id, itemId)
        else {
          const { error } = await supabase.from('packing_items').delete().eq('id', itemId)
          if (error) throw error
        }
        await refresh()
      }),

      loadChat: () => run(async () => {
        if (!activeTrip) return []
        if (!hasSupabase) return localStore.chat(activeTrip.id)
        const { data, error } = await supabase
          .from('assistant_messages')
          .select('role,content')
          .eq('trip_id', activeTrip.id)
          .order('created_at')
        if (error) throw error
        return data
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
  }, [trips, activeTrip, activeTripId, loading, refresh, user, toast])

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export const useTrips = () => useContext(TripContext)
