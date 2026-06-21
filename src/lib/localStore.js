const USERS_KEY = 'ruta26_dev_users'
const SESSION_KEY = 'ruta26_dev_session'
const TRIPS_KEY = 'ruta26_dev_trips'
const CHAT_KEY = 'ruta26_dev_chat'

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

const getTrip = (trips, tripId) => {
  const trip = trips.find(item => item.id === tripId)
  if (!trip) throw new Error('Viaje no encontrado')
  trip.days ||= []
  trip.hotels ||= []
  trip.expenses ||= []
  trip.packingItems ||= []
  trip.documents ||= []
  return trip
}

const nextPos = list => (list || []).reduce((max, item) => Math.max(max, item.position || item.day || 0), 0) + 1

const localIdeas = {
  culture:['Museo destacado', 'Barrio histórico', 'Monumento emblemático'],
  food:['Mercado local', 'Restaurante de cocina típica', 'Café recomendado'],
  nature:['Parque urbano', 'Mirador panorámico', 'Jardín botánico'],
  entertainment:['Tour guiado', 'Espectáculo local', 'Paseo al atardecer'],
  transport:['Traslado entre ciudades', 'Pase de transporte', 'Estación principal']
}

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

  deleteTrip(tripId) {
    write(TRIPS_KEY, read(TRIPS_KEY, []).filter(trip => trip.id !== tripId))
  },

  createEuropeDemo(user) {
    const trips = read(TRIPS_KEY, [])
    const memberId = id()
    const tripId = id()
    const activity = (position, name, time, category, address, latitude, longitude, priceLabel = '') => ({
      id:id(), position, name, time, category, address, latitude, longitude, priceLabel
    })
    const days = [
      {
        id:id(), day:1, date:'2026-09-05', city:'Madrid', title:'Madrid histórico', subtitle:'Primer paseo por el centro',
        activities:[
          activity(1, 'Desayuno en Plaza Mayor', '09:00', 'food', 'Plaza Mayor, Madrid', 40.4155, -3.7074, '12 EUR'),
          activity(2, 'Palacio Real de Madrid', '11:00', 'culture', 'C. de Bailén, Madrid', 40.4180, -3.7143, '14 EUR'),
          activity(3, 'Paseo por Gran Vía', '17:00', 'entertainment', 'Gran Vía, Madrid', 40.4200, -3.7058)
        ]
      },
      {
        id:id(), day:2, date:'2026-09-06', city:'Madrid', title:'Arte y parque', subtitle:'Museos y tarde tranquila',
        activities:[
          activity(1, 'Museo del Prado', '10:00', 'culture', 'C. de Ruiz de Alarcón 23, Madrid', 40.4138, -3.6921, '15 EUR'),
          activity(2, 'Almuerzo en Barrio de Las Letras', '13:30', 'food', 'Plaza de Santa Ana, Madrid', 40.4147, -3.7003, '25 EUR'),
          activity(3, 'Parque del Retiro', '16:30', 'nature', 'Plaza de la Independencia, Madrid', 40.4153, -3.6844)
        ]
      },
      {
        id:id(), day:3, date:'2026-09-07', city:'Paris', title:'Llegada a París', subtitle:'Iconos de la ciudad',
        activities:[
          activity(1, 'Tren Madrid → París', '07:30', 'transport', 'Madrid Puerta de Atocha', 40.4066, -3.6892, '95 EUR'),
          activity(2, 'Torre Eiffel y Campo de Marte', '16:00', 'culture', 'Champ de Mars, Paris', 48.8584, 2.2945, '29 EUR'),
          activity(3, 'Crucero por el Sena', '19:30', 'entertainment', 'Port de la Bourdonnais, Paris', 48.8601, 2.2930, '18 EUR')
        ]
      },
      {
        id:id(), day:4, date:'2026-09-08', city:'Paris', title:'Museos y Montmartre', subtitle:'Arte y barrios',
        activities:[
          activity(1, 'Museo del Louvre', '09:30', 'culture', 'Rue de Rivoli, Paris', 48.8606, 2.3376, '22 EUR'),
          activity(2, 'Jardín de las Tullerías', '13:00', 'nature', 'Place de la Concorde, Paris', 48.8635, 2.3275),
          activity(3, 'Atardecer en Sacré-Cœur', '18:00', 'culture', '35 Rue du Chevalier de la Barre, Paris', 48.8867, 2.3431)
        ]
      },
      {
        id:id(), day:5, date:'2026-09-09', city:'Amsterdam', title:'Canales de Ámsterdam', subtitle:'Llegada y paseo en bicicleta',
        activities:[
          activity(1, 'Tren París → Ámsterdam', '08:20', 'transport', 'Gare du Nord, Paris', 48.8809, 2.3553, '65 EUR'),
          activity(2, 'Paseo por Jordaan', '14:30', 'entertainment', 'Jordaan, Amsterdam', 52.3752, 4.8839),
          activity(3, 'Crucero por los canales', '18:00', 'entertainment', 'Prins Hendrikkade, Amsterdam', 52.3778, 4.9003, '21 EUR')
        ]
      },
      {
        id:id(), day:6, date:'2026-09-10', city:'Amsterdam', title:'Museos y mercados', subtitle:'Cultura neerlandesa',
        activities:[
          activity(1, 'Rijksmuseum', '09:30', 'culture', 'Museumstraat 1, Amsterdam', 52.3600, 4.8852, '25 EUR'),
          activity(2, 'Almuerzo en De Pijp', '13:00', 'food', 'Albert Cuypstraat, Amsterdam', 52.3559, 4.8952, '22 EUR'),
          activity(3, 'Casa de Ana Frank', '16:30', 'culture', 'Westermarkt 20, Amsterdam', 52.3752, 4.8840, '16 EUR')
        ]
      },
      {
        id:id(), day:7, date:'2026-09-11', city:'Rome', title:'Roma imperial', subtitle:'Llegada e historia antigua',
        activities:[
          activity(1, 'Vuelo Ámsterdam → Roma', '08:15', 'transport', 'Amsterdam Airport Schiphol', 52.3105, 4.7683, '110 EUR'),
          activity(2, 'Coliseo y Foro Romano', '15:00', 'culture', 'Piazza del Colosseo, Roma', 41.8902, 12.4922, '24 EUR'),
          activity(3, 'Cena en Monti', '20:00', 'food', 'Rione Monti, Roma', 41.8957, 12.4931, '32 EUR')
        ]
      },
      {
        id:id(), day:8, date:'2026-09-12', city:'Rome', title:'Vaticano y centro', subtitle:'Arte y plazas',
        activities:[
          activity(1, 'Museos Vaticanos', '09:00', 'culture', 'Viale Vaticano, Roma', 41.9065, 12.4536, '20 EUR'),
          activity(2, 'Piazza Navona', '15:00', 'culture', 'Piazza Navona, Roma', 41.8992, 12.4731),
          activity(3, 'Fontana di Trevi', '18:30', 'culture', 'Piazza di Trevi, Roma', 41.9009, 12.4833)
        ]
      },
      {
        id:id(), day:9, date:'2026-09-13', city:'Rome', title:'Sabores de Roma', subtitle:'Mercados y barrios',
        activities:[
          activity(1, 'Mercado de Campo de’ Fiori', '09:30', 'food', 'Campo de’ Fiori, Roma', 41.8957, 12.4722),
          activity(2, 'Paseo por Trastevere', '13:00', 'entertainment', 'Trastevere, Roma', 41.8897, 12.4708),
          activity(3, 'Clase de pasta', '17:00', 'food', 'Via dei Fienaroli, Roma', 41.8890, 12.4698, '55 EUR')
        ]
      },
      {
        id:id(), day:10, date:'2026-09-14', city:'Rome', title:'Última mañana', subtitle:'Compras y regreso',
        activities:[
          activity(1, 'Desayuno italiano', '09:00', 'food', 'Piazza della Rotonda, Roma', 41.8986, 12.4769, '9 EUR'),
          activity(2, 'Panteón de Roma', '10:30', 'culture', 'Piazza della Rotonda, Roma', 41.8986, 12.4769, '5 EUR'),
          activity(3, 'Traslado al aeropuerto', '14:00', 'transport', 'Roma Termini', 41.9010, 12.5018, '16 EUR')
        ]
      }
    ]
    const trip = {
      id:tripId,
      name:'Europa esencial · 10 días',
      startDate:'2026-09-05',
      endDate:'2026-09-14',
      currency:'EUR',
      timezone:'Europe/Madrid',
      ownerId:user.id,
      members:[{ id:memberId, userId:user.id, name:user.name, email:user.email, role:'owner', status:'active' }],
      invitations:[],
      days,
      hotels:[
        { id:id(), city:'Madrid', name:'Hotel Europa Centro', address:'Calle del Arenal 12, Madrid', check_in:'2026-09-05', check_out:'2026-09-07', latitude:40.4172, longitude:-3.7062 },
        { id:id(), city:'Paris', name:'Hôtel du Marais', address:'Rue des Archives 18, Paris', check_in:'2026-09-07', check_out:'2026-09-09', latitude:48.8608, longitude:2.3580 },
        { id:id(), city:'Amsterdam', name:'Canal House Jordaan', address:'Prinsengracht 315, Amsterdam', check_in:'2026-09-09', check_out:'2026-09-11', latitude:52.3747, longitude:4.8841 },
        { id:id(), city:'Rome', name:'Residenza Monti', address:'Via Urbana 20, Roma', check_in:'2026-09-11', check_out:'2026-09-14', latitude:41.8960, longitude:12.4935 }
      ],
      expenses:[
        { id:id(), description:'Hoteles', amount:920, currency:'EUR', category:'hotel', date:'2026-09-05', paidBy:user.id },
        { id:id(), description:'Trenes europeos', amount:160, currency:'EUR', category:'transport', date:'2026-09-07', paidBy:user.id },
        { id:id(), description:'Vuelo Ámsterdam → Roma', amount:110, currency:'EUR', category:'transport', date:'2026-09-11', paidBy:user.id },
        { id:id(), description:'Entradas y reservas', amount:204, currency:'EUR', category:'activity', date:'2026-09-05', paidBy:user.id },
        { id:id(), description:'Presupuesto comidas', amount:520, currency:'EUR', category:'food', date:'2026-09-05', paidBy:user.id }
      ],
      packingItems:[
        { id:id(), item:'Pasaporte', category:'essential', packed:true },
        { id:id(), item:'Seguro de viaje', category:'essential', packed:true },
        { id:id(), item:'Adaptador europeo', category:'essential', packed:false },
        { id:id(), item:'Zapatillas cómodas', category:'clothes', packed:false },
        { id:id(), item:'Chaqueta liviana', category:'clothes', packed:false },
        { id:id(), item:'Reservas descargadas', category:'documents', packed:true }
      ],
      documents:[],
      createdAt:new Date().toISOString()
    }
    write(TRIPS_KEY, [...trips, trip])
    return trip
  },

  updateTrip(tripId, updates) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) trip[key] = value
    }
    write(TRIPS_KEY, trips)
    return trip
  },

  invite(tripId, email) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.invitations = [
      ...trip.invitations.filter(item => item.email !== email.toLowerCase()),
      { id:id(), email:email.toLowerCase(), role:'editor', status:'pending', createdAt:new Date().toISOString() }
    ]
    write(TRIPS_KEY, trips)
    return trip
  },

  revokeInvite(tripId, invitationId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.invitations = trip.invitations.filter(item => item.id !== invitationId)
    write(TRIPS_KEY, trips)
    return trip
  },

  addDay(tripId, values) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.days.push({
      id:id(),
      day:nextPos(trip.days),
      date:values.date || '',
      city:values.city,
      title:values.title || `Día en ${values.city}`,
      subtitle:'',
      activities:[]
    })
    write(TRIPS_KEY, trips)
    return trip
  },

  deleteDay(tripId, dayId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.days = trip.days.filter(day => day.id !== dayId)
    trip.days.forEach((day, index) => { day.day = index + 1 })
    write(TRIPS_KEY, trips)
    return trip
  },

  restoreDay(tripId, day) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.days.push(day)
    trip.days.sort((a, b) => (a.position || a.day) - (b.position || b.day))
    write(TRIPS_KEY, trips)
    return trip
  },

  updateDay(tripId, dayId, fields) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const day = trip.days.find(item => item.id === dayId)
    if (!day) throw new Error('Día no encontrado')
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) day[key] = value
    }
    write(TRIPS_KEY, trips)
    return trip
  },

  reorderDays(tripId, firstId, secondId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const first = trip.days.find(item => item.id === firstId)
    const second = trip.days.find(item => item.id === secondId)
    if (!first || !second) throw new Error('Día no encontrado')
    const firstPosition = first.position || first.day
    first.position = second.position || second.day
    second.position = firstPosition
    first.day = first.position
    second.day = second.position
    trip.days.sort((a, b) => (a.position || a.day) - (b.position || b.day))
    write(TRIPS_KEY, trips)
    return trip
  },

  addActivity(tripId, dayId, values) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const day = trip.days.find(item => item.id === dayId)
    if (!day) throw new Error('Día no encontrado')
    day.activities ||= []
    day.activities.push({
      id:id(),
      position:nextPos(day.activities),
      name:values.name,
      time:values.time || '',
      duration:values.duration || '',
      address:values.address || '',
      category:values.category || 'entertainment',
      priceLabel:values.priceLabel || '',
      expenseAmount:Number(values.expenseAmount) || 0,
      expenseCurrency:values.expenseCurrency || '',
      latitude:values.latitude ?? null,
      longitude:values.longitude ?? null,
      tripadvisorLocationId:values.tripadvisorLocationId || '',
      imageUrl:values.imageUrl || '',
      done:!!values.done
    })
    write(TRIPS_KEY, trips)
    return trip
  },

  updateActivity(tripId, dayId, activityId, fields) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const day = trip.days.find(item => item.id === dayId)
    const activity = day?.activities?.find(item => item.id === activityId)
    if (!activity) throw new Error('Panorama no encontrado')
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) activity[key] = value
    }
    write(TRIPS_KEY, trips)
    return trip
  },

  deleteActivity(tripId, dayId, activityId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const day = trip.days.find(item => item.id === dayId)
    if (day) day.activities = (day.activities || []).filter(item => item.id !== activityId)
    write(TRIPS_KEY, trips)
    return trip
  },

  restoreActivity(tripId, dayId, activity) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const day = trip.days.find(item => item.id === dayId)
    day.activities.push(activity)
    day.activities.sort((a, b) => a.position - b.position)
    write(TRIPS_KEY, trips)
    return trip
  },

  reorderActivities(tripId, dayId, firstId, secondId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const day = trip.days.find(item => item.id === dayId)
    const first = day?.activities?.find(item => item.id === firstId)
    const second = day?.activities?.find(item => item.id === secondId)
    if (!first || !second) throw new Error('Panorama no encontrado')
    const position = first.position
    first.position = second.position
    second.position = position
    day.activities.sort((a, b) => a.position - b.position)
    write(TRIPS_KEY, trips)
    return trip
  },

  toggleActivityDone(tripId, dayId, activityId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const day = trip.days.find(item => item.id === dayId)
    const activity = day?.activities?.find(item => item.id === activityId)
    if (!activity) throw new Error('Panorama no encontrado')
    activity.done = !activity.done
    write(TRIPS_KEY, trips)
    return trip
  },

  placeSuggestions(city, category = 'culture') {
    return (localIdeas[category] || localIdeas.culture).map((name, index) => ({
      locationId:`local-${category}-${index}`,
      name:`${name} en ${city}`,
      category,
      description:'Idea de ejemplo disponible en modo local.',
      address:city,
      provider:'Ruta26 local',
      externalContent:false
    }))
  },

  addHotel(tripId, values) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.hotels.push({ id:id(), city:values.city, name:values.name, address:values.address || '', check_in:values.checkIn || '', check_out:values.checkOut || '', latitude:values.latitude ?? null, longitude:values.longitude ?? null, cost:values.cost ?? null, cost_currency:values.costCurrency || '', url:values.url || '' })
    write(TRIPS_KEY, trips)
    return trip
  },

  addDocument(tripId, doc) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.documents.push({
      id:id(), tripId, activityId:doc.activityId || null, name:doc.name || 'Archivo',
      type:doc.type || 'other', storagePath:doc.storagePath || '', mime:doc.mime || '',
      notes:doc.notes || '', createdAt:new Date().toISOString()
    })
    write(TRIPS_KEY, trips)
    return trip
  },

  deleteDocument(tripId, docId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.documents = trip.documents.filter(item => item.id !== docId)
    write(TRIPS_KEY, trips)
    return trip
  },

  deleteHotel(tripId, hotelId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.hotels = trip.hotels.filter(item => item.id !== hotelId)
    write(TRIPS_KEY, trips)
    return trip
  },

  restoreHotel(tripId, hotel) {
    const trips = read(TRIPS_KEY, [])
    getTrip(trips, tripId).hotels.push(hotel)
    write(TRIPS_KEY, trips)
  },

  addExpense(tripId, values) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.expenses.push({
      id:id(),
      description:values.description,
      amount:Number(values.amount),
      currency:values.currency || trip.currency || 'USD',
      category:values.category || 'activity',
      date:values.date || '',
      paidBy:values.paidBy || null,
      activityId:values.activityId || null,
      hotelId:values.hotelId || null,
      isSettlement:!!values.isSettlement,
      split:values.split || {}
    })
    write(TRIPS_KEY, trips)
    return trip
  },

  updateExpense(tripId, expenseId, fields) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const expense = trip.expenses.find(item => item.id === expenseId)
    if (expense) Object.assign(expense, fields)
    write(TRIPS_KEY, trips)
    return trip
  },

  deleteExpense(tripId, expenseId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.expenses = trip.expenses.filter(item => item.id !== expenseId)
    write(TRIPS_KEY, trips)
    return trip
  },

  restoreExpense(tripId, expense) {
    const trips = read(TRIPS_KEY, [])
    getTrip(trips, tripId).expenses.push(expense)
    write(TRIPS_KEY, trips)
  },

  addPackingItem(tripId, item) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.packingItems.push({ id:id(), item, packed:false })
    write(TRIPS_KEY, trips)
    return trip
  },

  addPackingItems(tripId, items) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.packingItems.push(...items.map(item => ({ id:id(), item, packed:false, category:'essential' })))
    write(TRIPS_KEY, trips)
    return trip
  },

  togglePackingItem(tripId, itemId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    const entry = trip.packingItems.find(item => item.id === itemId)
    if (entry) entry.packed = !entry.packed
    write(TRIPS_KEY, trips)
    return trip
  },

  deletePackingItem(tripId, itemId) {
    const trips = read(TRIPS_KEY, [])
    const trip = getTrip(trips, tripId)
    trip.packingItems = trip.packingItems.filter(item => item.id !== itemId)
    write(TRIPS_KEY, trips)
    return trip
  },

  restorePackingItem(tripId, item) {
    const trips = read(TRIPS_KEY, [])
    getTrip(trips, tripId).packingItems.push(item)
    write(TRIPS_KEY, trips)
  },

  chat(tripId) {
    return read(CHAT_KEY, {})[tripId] || []
  },

  appendChat(tripId, messages) {
    const all = read(CHAT_KEY, {})
    all[tripId] = [...(all[tripId] || []), ...messages]
    write(CHAT_KEY, all)
  },

  clearChat(tripId) {
    const all = read(CHAT_KEY, {})
    delete all[tripId]
    write(CHAT_KEY, all)
  },

  assistantReply(tripId, _prompt) {
    const trip = read(TRIPS_KEY, []).find(item => item.id === tripId)
    if (!trip) return 'No encuentro el viaje.'
    const days = trip.days || []
    const activityCount = days.reduce((sum, day) => sum + (day.activities?.length || 0), 0)
    const totals = {}
    for (const expense of trip.expenses || []) {
      totals[expense.currency] = (totals[expense.currency] || 0) + Number(expense.amount || 0)
    }
    const spent = Object.entries(totals).map(([currency, value]) => `${value.toFixed(2)} ${currency}`).join(', ') || 'sin gastos registrados'
    const emptyDays = days.filter(day => !(day.activities?.length)).map(day => day.title)
    return [
      `Resumen de "${trip.name}": ${days.length} día(s) planificado(s), ${activityCount} panorama(s), gastos: ${spent}.`,
      emptyDays.length ? `Días sin panoramas: ${emptyDays.join(', ')}.` : '',
      '',
      'Estás en modo local: la IA completa requiere conectar Supabase y configurar OPENAI_API_KEY. Las recomendaciones de lugares en vivo también requieren TRIPADVISOR_API_KEY en el backend.'
    ].filter(Boolean).join('\n')
  }
}
