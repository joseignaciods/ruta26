const USERS_KEY = 'ruta26_dev_users'
const SESSION_KEY = 'ruta26_dev_session'
const TRIPS_KEY = 'ruta26_dev_trips'

const read = (key, fallback) => {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

const write = (key, value) => localStorage.setItem(key, JSON.stringify(value))
const id = () => crypto.randomUUID()

export const localStore = {
  session() {
    return read(SESSION_KEY, null)
  },

  register({ name, email, password }) {
    const users = read(USERS_KEY, [])
    if (users.some(user => user.email === email.toLowerCase())) throw new Error('El correo ya está registrado')
    const user = { id:id(), name, email:email.toLowerCase(), password }
    write(USERS_KEY, [...users, user])
    const session = { user:{ id:user.id, name:user.name, email:user.email } }
    write(SESSION_KEY, session)
    return session
  },

  login({ email, password }) {
    const user = read(USERS_KEY, []).find(item => item.email === email.toLowerCase() && item.password === password)
    if (!user) throw new Error('Correo o contraseña incorrectos')
    const session = { user:{ id:user.id, name:user.name, email:user.email } }
    write(SESSION_KEY, session)
    return session
  },

  logout() {
    localStorage.removeItem(SESSION_KEY)
  },

  trips(userId) {
    return read(TRIPS_KEY, []).filter(trip => trip.members.some(member => member.userId === userId))
  },

  createTrip(user, values) {
    const trips = read(TRIPS_KEY, [])
    const trip = {
      id:id(),
      name:values.name,
      startDate:values.startDate || '',
      endDate:values.endDate || '',
      currency:values.currency || 'USD',
      timezone:values.timezone || 'America/Santiago',
      ownerId:user.id,
      members:[{ id:id(), userId:user.id, name:user.name, email:user.email, role:'owner', status:'active' }],
      invitations:[],
      days:[],
      hotels:[],
      expenses:[],
      packingItems:[],
      documents:[],
      createdAt:new Date().toISOString()
    }
    write(TRIPS_KEY, [...trips, trip])
    return trip
  },

  updateTrip(tripId, updates) {
    const trips = read(TRIPS_KEY, [])
    const trip = trips.find(item => item.id === tripId)
    if (!trip) throw new Error('Viaje no encontrado')
    Object.assign(trip, updates)
    write(TRIPS_KEY, trips)
    return trip
  },

  invite(tripId, email) {
    const trips = read(TRIPS_KEY, [])
    const trip = trips.find(item => item.id === tripId)
    if (!trip) throw new Error('Viaje no encontrado')
    trip.invitations = [
      ...trip.invitations.filter(item => item.email !== email.toLowerCase()),
      { id:id(), email:email.toLowerCase(), role:'editor', status:'pending', createdAt:new Date().toISOString() }
    ]
    write(TRIPS_KEY, trips)
    return trip
  },

  revokeInvite(tripId, invitationId) {
    const trips = read(TRIPS_KEY, [])
    const trip = trips.find(item => item.id === tripId)
    trip.invitations = trip.invitations.filter(item => item.id !== invitationId)
    write(TRIPS_KEY, trips)
    return trip
  },

  addDay(tripId, values) {
    const trips = read(TRIPS_KEY, [])
    const trip = trips.find(item => item.id === tripId)
    const day = {
      id:id(),
      day:trip.days.length + 1,
      date:values.date || '',
      city:values.city,
      title:values.title || `Día en ${values.city}`,
      subtitle:'',
      activities:[]
    }
    trip.days.push(day)
    write(TRIPS_KEY, trips)
    return trip
  }
}
