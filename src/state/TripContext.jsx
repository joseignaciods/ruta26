import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { hasSupabase, supabase } from '../lib/supabase.js'
import { localStore } from '../lib/localStore.js'
import { useAuth } from './AuthContext.jsx'

const TripContext = createContext(null)

const mapTrip = row => ({
  id:row.id,
  name:row.name,
  startDate:row.start_date,
  endDate:row.end_date,
  currency:row.currency,
  timezone:row.timezone,
  ownerId:row.owner_id,
  members:row.trip_members || [],
  invitations:row.trip_invitations || [],
  days:row.days || []
})

export function TripProvider({ children }) {
  const { user } = useAuth()
  const [trips, setTrips] = useState([])
  const [activeTripId, setActiveTripId] = useState(localStorage.getItem('ruta26_active_trip'))
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setTrips([])
      return
    }
    setLoading(true)
    if (!hasSupabase) {
      setTrips(localStore.trips(user.id))
    } else {
      const { data, error } = await supabase
        .from('trips')
        .select('*, trip_members(*), trip_invitations(*), days(*, activities(*))')
        .order('created_at', { ascending:false })
      if (error) throw error
      setTrips(data.map(mapTrip))
    }
    setLoading(false)
  }, [user])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (activeTripId) localStorage.setItem('ruta26_active_trip', activeTripId)
    else localStorage.removeItem('ruta26_active_trip')
  }, [activeTripId])

  const activeTrip = trips.find(trip => trip.id === activeTripId) || null

  const value = useMemo(() => ({
    trips, activeTrip, activeTripId, loading, setActiveTripId, refresh,
    async createTrip(values) {
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
    },
    async updateTrip(updates) {
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
        const { error } = await supabase.from('trips').update(payload).eq('id', activeTrip.id)
        if (error) throw error
      }
      await refresh()
    },
    async invite(email) {
      if (!activeTrip) return
      if (!hasSupabase) localStore.invite(activeTrip.id, email)
      else {
        const { error } = await supabase.functions.invoke('invite-member', {
          body:{ tripId:activeTrip.id, email }
        })
        if (error) throw error
      }
      await refresh()
    },
    async revokeInvite(invitationId) {
      if (!activeTrip) return
      if (!hasSupabase) localStore.revokeInvite(activeTrip.id, invitationId)
      else {
        const { error } = await supabase.from('trip_invitations').delete().eq('id', invitationId)
        if (error) throw error
      }
      await refresh()
    },
    async addDay(values) {
      if (!activeTrip) return
      if (!hasSupabase) localStore.addDay(activeTrip.id, values)
      else {
        const { error } = await supabase.from('days').insert({
          trip_id:activeTrip.id,
          position:activeTrip.days.length + 1,
          date:values.date || null,
          city:values.city,
          title:values.title || `Día en ${values.city}`
        })
        if (error) throw error
      }
      await refresh()
    }
  }), [trips, activeTrip, activeTripId, loading, refresh, user])

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}

export const useTrips = () => useContext(TripContext)
