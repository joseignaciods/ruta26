import { useRef, useState } from 'react'
import { useTrips } from '../state/TripContext.jsx'
import CategoryIcon, { categories, categoryFor } from './CategoryIcon.jsx'
import { addDays, formatDate, suggestNextTime } from '../lib/planner.js'

const emptyActivity = { name:'', time:'', duration:'', address:'', priceLabel:'', category:'culture', latitude:null, longitude:null, tripadvisorLocationId:'' }

const isExternalId = locationId => Boolean(locationId) && !String(locationId).startsWith('local-')

const inferCategory = (place, fallback) => {
  if (categories.some(category => category.id === place.category)) return place.category
  const labels = [place.category, ...(place.subcategories || [])].join(' ').toLowerCase()
  if (/restaurant|comida|café|cafe|bar|food/.test(labels)) return 'food'
  if (/parque|jardín|jardin|naturaleza|playa|nature/.test(labels)) return 'nature'
  if (/museo|museum|historia|cultural|monumento|galería|galeria/.test(labels)) return 'culture'
  return fallback
}

export default function RouteTab({ onAskAssistant }) {
  const {
    activeTrip, addDay, updateDay, deleteDay, reorderDays,
    addActivity, updateActivity, deleteActivity, reorderActivities,
    discoverPlaces, searchPlaces
  } = useTrips()
  const [showDay, setShowDay] = useState(false)
  const [dayForm, setDayForm] = useState({ city:'', title:'', date:'' })
  const [editingDayId, setEditingDayId] = useState(null)
  const [editingActivityId, setEditingActivityId] = useState(null)
  const [orderingDayId, setOrderingDayId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [composerDayId, setComposerDayId] = useState(null)
  const [ideasDayId, setIdeasDayId] = useState(null)
  const [actForm, setActForm] = useState(emptyActivity)
  const [ideas, setIdeas] = useState([])
  const [ideasProvider, setIdeasProvider] = useState('')
  const [ideasBusy, setIdeasBusy] = useState(false)
  const [menuActivityId, setMenuActivityId] = useState(null)
  const [acResults, setAcResults] = useState([])
  const [acOpen, setAcOpen] = useState(false)
  const acTimer = useRef(null)

  const createDay = async event => {
    event.preventDefault()
    const result = editingDayId ? await updateDay(editingDayId, dayForm) : await addDay(dayForm)
    if (result !== null) {
      setShowDay(false)
      setEditingDayId(null)
      setDayForm({ city:'', title:'', date:'' })
    }
  }

  const closeComposer = () => {
    setComposerDayId(null)
    setEditingActivityId(null)
    setAcOpen(false)
    setAcResults([])
    clearTimeout(acTimer.current)
  }

  const createActivity = async (event, dayId) => {
    event.preventDefault()
    const result = editingActivityId
      ? await updateActivity(dayId, editingActivityId, actForm)
      : await addActivity(dayId, actForm)
    if (result !== null) {
      setActForm(emptyActivity)
      closeComposer()
    }
  }

  const toggleDay = dayId => {
    setExpandedId(current => current === dayId ? null : dayId)
    closeComposer()
    setIdeasDayId(null)
    setMenuActivityId(null)
    setActForm(emptyActivity)
  }

  const openComposer = (day, category = 'culture') => {
    setEditingActivityId(null)
    setComposerDayId(day.id)
    setIdeasDayId(null)
    setActForm({ ...emptyActivity, category, time:suggestNextTime(day.activities) })
  }

  const editActivity = (day, activity) => {
    setEditingActivityId(activity.id)
    setComposerDayId(day.id)
    setIdeasDayId(null)
    setActForm({
      ...emptyActivity,
      name:activity.name,
      time:activity.time,
      duration:activity.duration || '',
      address:activity.address,
      priceLabel:activity.priceLabel,
      category:activity.category,
      latitude:activity.latitude,
      longitude:activity.longitude,
      tripadvisorLocationId:activity.tripadvisorLocationId
    })
  }

  const openDayForm = day => {
    setEditingDayId(day?.id || null)
    setDayForm(day
      ? { city:day.city, title:day.title, date:day.date || '' }
      : {
          city:'',
          title:'',
          date:activeTrip.startDate ? addDays(activeTrip.startDate, activeTrip.days.length) : ''
        })
    setShowDay(true)
  }

  const moveActivity = async (day, index, direction) => {
    const other = day.activities[index + direction]
    if (other) await reorderActivities(day.id, day.activities[index].id, other.id)
  }

  const moveDay = async (index, direction) => {
    const other = activeTrip.days[index + direction]
    if (other) await reorderDays(activeTrip.days[index].id, other.id)
  }

  const loadIdeas = async (day, category = actForm.category) => {
    setIdeasDayId(day.id)
    closeComposer()
    setActForm(current => ({ ...current, category }))
    setIdeasBusy(true)
    setIdeas([])
    const result = await discoverPlaces(day.city, category)
    setIdeasBusy(false)
    if (result) {
      setIdeas(result.places || [])
      setIdeasProvider(result.provider || '')
    }
  }

  const chooseLocalIdea = (dayId, idea) => {
    setActForm({
      ...emptyActivity,
      category:idea.category || actForm.category,
      name:idea.name || '',
      address:idea.address || '',
      latitude:idea.latitude ?? null,
      longitude:idea.longitude ?? null,
      tripadvisorLocationId:isExternalId(idea.locationId) ? idea.locationId : ''
    })
    setIdeasDayId(null)
    setComposerDayId(dayId)
  }

  const addIdeaDirect = async (day, idea) => {
    await addActivity(day.id, {
      name:idea.name,
      category:actForm.category,
      time:suggestNextTime(day.activities),
      address:idea.address || '',
      priceLabel:'',
      latitude:idea.latitude ?? null,
      longitude:idea.longitude ?? null,
      tripadvisorLocationId:isExternalId(idea.locationId) ? idea.locationId : ''
    })
  }

  const quickPresets = day => {
    const hotel = activeTrip.hotels.find(item => item.city.toLowerCase() === day.city.toLowerCase())
    const presets = [
      { key:'breakfast', label:'Desayuno', values:{ ...emptyActivity, name:'Desayuno', category:'food', time:'09:00' } },
      { key:'lunch', label:'Almuerzo', values:{ ...emptyActivity, name:'Almuerzo', category:'food', time:'13:30' } },
      { key:'dinner', label:'Cena', values:{ ...emptyActivity, name:'Cena', category:'food', time:'20:30' } },
      { key:'transfer', label:'Traslado', values:{ ...emptyActivity, name:'Traslado', category:'transport', time:suggestNextTime(day.activities) } }
    ]
    if (hotel) presets.push({
      key:'checkin',
      label:'Check-in hotel',
      values:{ ...emptyActivity, name:`Check-in ${hotel.name}`, category:'transport', time:'15:00', address:hotel.address || hotel.city, latitude:hotel.latitude, longitude:hotel.longitude }
    })
    return presets
  }

  const onNameChange = (day, value) => {
    setActForm(current => ({ ...current, name:value, latitude:null, longitude:null, tripadvisorLocationId:'' }))
    clearTimeout(acTimer.current)
    const clean = value.trim()
    if (clean.length < 3) {
      setAcOpen(false)
      setAcResults([])
      return
    }
    acTimer.current = setTimeout(async () => {
      const result = await searchPlaces(clean, day.city, actForm.category)
      const places = (result?.places || []).slice(0, 5)
      setAcResults(places)
      setAcOpen(places.length > 0)
    }, 400)
  }

  const pickSuggestion = place => {
    setActForm(current => ({
      ...current,
      name:place.name || current.name,
      address:place.address || current.address,
      category:inferCategory(place, current.category),
      latitude:place.latitude ?? null,
      longitude:place.longitude ?? null,
      tripadvisorLocationId:isExternalId(place.locationId) ? place.locationId : ''
    }))
    setAcOpen(false)
    setAcResults([])
  }

  const contextActions = (day, activity) => ([
    {
      label:'Está cerrado',
      prompt:`El panorama "${activity.name}" (activity_id ${activity.id}, día ${day.position} en ${day.city}) está cerrado. Propón 2 o 3 alternativas cercanas similares y pregúntame cuál prefiero antes de cambiar nada.`
    },
    {
      label:'Cambiar por otro plan',
      prompt:`Quiero cambiar el panorama "${activity.name}" (activity_id ${activity.id}, día ${day.position} en ${day.city}) por otra cosa. Propón 2 o 3 opciones variadas y espera mi confirmación antes de modificar el viaje.`
    },
    {
      label:'No tengo ganas de esto',
      prompt:`No tengo ánimo para "${activity.name}" (activity_id ${activity.id}, día ${day.position} en ${day.city}). Pregúntame qué mood tengo dándome opciones rápidas y luego sugiere un reemplazo.`
    }
  ])

  const removeDay = day => deleteDay(day.id)

  return (
    <section>
      <div className="section-heading">
        <div><h2>Ruta</h2><p>{activeTrip.days.length} días planificados</p></div>
        <button className="primary-btn compact" onClick={() => openDayForm()}>+ Día</button>
      </div>

      {activeTrip.days.length === 0 ? (
        <div className="empty-panel workspace-empty">
          <div className="empty-icon">◇</div>
          <h2>Tu ruta está vacía</h2>
          <p>Agrega el primer día o pídele al asistente ✦ que arme una ruta por ti.</p>
        </div>
      ) : activeTrip.days.map((day, dayIndex) => (
        <article className={`day-card ${expandedId === day.id ? 'open' : ''}`} key={day.id}>
          <button type="button" className="day-head" onClick={() => toggleDay(day.id)}>
            <div className="day-number">{day.position}</div>
            <div className="day-info">
              <span>{formatDate(day.date) || 'Sin fecha'} · {day.city}</span>
              <h3>{day.title}</h3>
              <div className="day-preview">
                {day.activities.slice(0, 6).map(activity => <CategoryIcon key={activity.id} name={activity.category} />)}
                {day.activities.length > 6 && <small>+{day.activities.length - 6}</small>}
                <p>{day.activities.length} panoramas</p>
              </div>
            </div>
            <span className="chevron">{expandedId === day.id ? '▾' : '▸'}</span>
          </button>

          {expandedId === day.id && (
            <div className="day-body">
              <div className="day-tools">
                <button onClick={() => openDayForm(day)}>Editar día</button>
                <button onClick={() => setOrderingDayId(current => current === day.id ? null : day.id)}>
                  {orderingDayId === day.id ? 'Listo' : 'Ordenar'}
                </button>
                <button onClick={() => moveDay(dayIndex, -1)} disabled={dayIndex === 0}>↑ Día</button>
                <button onClick={() => moveDay(dayIndex, 1)} disabled={dayIndex === activeTrip.days.length - 1}>↓ Día</button>
              </div>
              <div className="activity-timeline">
                {day.activities.map((activity, activityIndex) => {
                  const category = categoryFor(activity.category)
                  return (
                    <div className={`activity-line category-${category.id}`} key={activity.id}>
                      <div className="activity-category-icon"><CategoryIcon name={category.id} /></div>
                      <button type="button" className="activity-copy" onClick={() => editActivity(day, activity)}>
                        <span>{[activity.time || 'Sin hora', activity.duration, category.label].filter(Boolean).join(' · ')}</span>
                        <h4>{activity.name}</h4>
                        {(activity.address || activity.priceLabel) && <small>{[activity.address, activity.priceLabel].filter(Boolean).join(' · ')}</small>}
                      </button>
                      {orderingDayId === day.id && (
                        <div className="order-controls">
                          <button onClick={() => moveActivity(day, activityIndex, -1)} disabled={activityIndex === 0}>↑</button>
                          <button onClick={() => moveActivity(day, activityIndex, 1)} disabled={activityIndex === day.activities.length - 1}>↓</button>
                        </div>
                      )}
                      {onAskAssistant && (
                        <div className="activity-menu">
                          <button className="icon-btn" onClick={() => setMenuActivityId(current => current === activity.id ? null : activity.id)} aria-label="Opciones del panorama">⋯</button>
                          {menuActivityId === activity.id && (
                            <div className="context-menu">
                              {contextActions(day, activity).map(action => (
                                <button key={action.label} onClick={() => { setMenuActivityId(null); onAskAssistant(action.prompt) }}>✦ {action.label}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button className="icon-btn" onClick={() => deleteActivity(day.id, activity.id)} aria-label="Eliminar panorama">✕</button>
                    </div>
                  )
                })}
              </div>

              {composerDayId !== day.id && ideasDayId !== day.id && (
                <>
                  <div className="quick-chips">
                    {quickPresets(day).map(preset => (
                      <button key={preset.key} onClick={() => addActivity(day.id, preset.values)}>+ {preset.label}</button>
                    ))}
                  </div>
                  <div className="route-actions">
                    <button className="add-panorama-btn" onClick={() => openComposer(day)}>
                      <span>+</span><div><b>Agregar panorama</b><small>Actividad, comida, paseo o traslado</small></div>
                    </button>
                    <button className="discover-btn" onClick={() => loadIdeas(day)}>
                      <CategoryIcon name="entertainment" /><span><b>Descubrir en {day.city}</b><small>Sugerencias para este día</small></span>
                    </button>
                  </div>
                </>
              )}

              {composerDayId === day.id && (
                <form className="activity-composer" onSubmit={event => createActivity(event, day.id)}>
                  <div className="composer-heading">
                    <div><span>{editingActivityId ? 'EDITAR PANORAMA' : 'NUEVO PANORAMA'}</span><h4>¿Qué quieres hacer?</h4></div>
                    <button type="button" className="icon-btn" onClick={closeComposer}>✕</button>
                  </div>
                  <div className="category-picker">
                    {categories.map(category => (
                      <button type="button" key={category.id} className={actForm.category === category.id ? 'active' : ''} onClick={() => setActForm({ ...actForm, category:category.id })}>
                        <CategoryIcon name={category.id} /><span>{category.label}</span>
                      </button>
                    ))}
                  </div>
                  <label className="composer-main-field">Nombre del panorama
                    <input autoFocus required placeholder={`Ej. ${categoryFor(actForm.category).hint}`} value={actForm.name} onChange={e => onNameChange(day, e.target.value)} />
                    {acOpen && (
                      <div className="ac-dropdown">
                        {acResults.map(place => (
                          <button type="button" key={place.locationId || place.name} onClick={() => pickSuggestion(place)}>
                            <b>{place.name}</b>
                            <small>{[place.address, place.rating ? `★ ${place.rating}` : ''].filter(Boolean).join(' · ')}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                  <div className="composer-grid">
                    <label>Hora<input type="time" value={actForm.time} onChange={e => setActForm({ ...actForm, time:e.target.value })} /></label>
                    <label>Duración<input placeholder="Ej. 2h" value={actForm.duration} onChange={e => setActForm({ ...actForm, duration:e.target.value })} /></label>
                  </div>
                  <label>Precio estimado<input placeholder="Ej. 20 EUR" value={actForm.priceLabel} onChange={e => setActForm({ ...actForm, priceLabel:e.target.value })} /></label>
                  <label>Ubicación <span className="optional-label">opcional</span>
                    <input placeholder="Dirección o barrio" value={actForm.address} onChange={e => setActForm({ ...actForm, address:e.target.value })} />
                  </label>
                  <div className="composer-footer">
                    <button type="button" className="inspiration-link" onClick={() => loadIdeas(day, actForm.category)}>¿Necesitas ideas?</button>
                    <button className="primary-btn compact">{editingActivityId ? 'Guardar cambios' : 'Agregar a la ruta'}</button>
                  </div>
                </form>
              )}

              {ideasDayId === day.id && (
                <div className="ideas-panel">
                  <div className="composer-heading">
                    <div><span>INSPIRACIÓN</span><h4>Ideas para {day.city}</h4></div>
                    <button type="button" className="icon-btn" onClick={() => setIdeasDayId(null)}>✕</button>
                  </div>
                  <div className="category-picker compact">
                    {categories.filter(category => category.id !== 'transport').map(category => (
                      <button type="button" key={category.id} className={actForm.category === category.id ? 'active' : ''} onClick={() => loadIdeas(day, category.id)}>
                        <CategoryIcon name={category.id} /><span>{category.label}</span>
                      </button>
                    ))}
                  </div>
                  {ideasBusy ? <div className="ideas-loading">Buscando buenas opciones...</div> : (
                    <div className="idea-list">
                      {ideas.map(idea => (
                        <article className="idea-card" key={idea.locationId || idea.name}>
                          <div className="idea-icon"><CategoryIcon name={actForm.category} /></div>
                          <div>
                            <div className="idea-meta">
                              <span>{ideasProvider === 'tripadvisor' ? 'TRIPADVISOR' : 'IDEA LOCAL'}</span>
                              {idea.rating && <b>★ {idea.rating} {idea.reviewCount ? `· ${idea.reviewCount}` : ''}</b>}
                            </div>
                            <h5>{idea.name}</h5>
                            <p>{idea.ranking || idea.description || idea.address}</p>
                            {idea.tripadvisorUrl && <a href={idea.tripadvisorUrl} target="_blank" rel="noreferrer">Ver en Tripadvisor</a>}
                          </div>
                          <div className="idea-actions">
                            <button className="idea-add" onClick={() => addIdeaDirect(day, idea)} aria-label={`Agregar ${idea.name}`}>+</button>
                            <button className="idea-use" onClick={() => chooseLocalIdea(day.id, idea)}>Editar</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {ideasProvider === 'tripadvisor' && <p className="provider-note">Resultados consultados en vivo en Tripadvisor. Al agregar uno solo guardamos nombre, dirección y ubicación.</p>}
                </div>
              )}

              <button className="danger-link" onClick={() => removeDay(day)}>Eliminar día</button>
            </div>
          )}
        </article>
      ))}

      {showDay && (
        <div className="modal-backdrop" onClick={() => setShowDay(false)}>
          <form className="modal-card" onSubmit={createDay} onClick={event => event.stopPropagation()}>
            <h2>{editingDayId ? 'Editar día' : 'Agregar día'}</h2>
            <label>Ciudad<input autoFocus required value={dayForm.city} onChange={e => setDayForm({ ...dayForm, city:e.target.value })} /></label>
            <label>Título<input value={dayForm.title} onChange={e => setDayForm({ ...dayForm, title:e.target.value })} /></label>
            <label>Fecha<input type="date" value={dayForm.date} onChange={e => setDayForm({ ...dayForm, date:e.target.value })} /></label>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => { setShowDay(false); setEditingDayId(null) }}>Cancelar</button>
              <button className="primary-btn compact">{editingDayId ? 'Guardar' : 'Agregar'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
