import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTrips } from '../state/TripContext.jsx'
import CategoryIcon, { categories, categoryFor } from './CategoryIcon.jsx'
import { inferCategory, intentForCategory } from '../lib/intents.js'
import { addDays, dayHotel, dayLoad, formatDate, formatKm, formatMinutes, suggestNextTime, travelEstimate } from '../lib/planner.js'
import { searchSpots, rememberPlace } from '../lib/geo.js'

// Lazy para que Leaflet no entre al bundle inicial (igual que MapTab).
const PlacePicker = lazy(() => import('./PlacePicker.jsx'))
const ItineraryGenerator = lazy(() => import('./ItineraryGenerator.jsx'))

const emptyActivity = { name:'', time:'', duration:'', address:'', priceLabel:'', category:'culture', latitude:null, longitude:null, tripadvisorLocationId:'' }

const isExternalId = locationId => Boolean(locationId) && !String(locationId).startsWith('local-')

export default function RouteTab({ onAskAssistant, onPickerChange }) {
  const {
    activeTrip, addDay, updateDay, deleteDay, reorderDays,
    addActivity, updateActivity, deleteActivity, reorderActivities,
    searchPlaces
  } = useTrips()
  const [showDay, setShowDay] = useState(false)
  const [dayForm, setDayForm] = useState({ city:'', title:'', date:'' })
  const [editingDayId, setEditingDayId] = useState(null)
  const [editingActivityId, setEditingActivityId] = useState(null)
  const [orderingDayId, setOrderingDayId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [composerDayId, setComposerDayId] = useState(null)
  const [picker, setPicker] = useState(null)
  const [generator, setGenerator] = useState(null)
  const [actForm, setActForm] = useState(emptyActivity)
  const [menuActivityId, setMenuActivityId] = useState(null)
  const [acResults, setAcResults] = useState([])
  const [acOpen, setAcOpen] = useState(false)
  const acTimer = useRef(null)
  const [daySpots, setDaySpots] = useState([])
  const [daySpotsBusy, setDaySpotsBusy] = useState(false)
  const daySpotTimer = useRef(null)
  const composerRef = useRef(null)

  // El editor de panorama es un formulario inline al final del día; al abrirlo
  // (editar o "a mano") lo traemos a la vista para que no parezca que "no pasa
  // nada" cuando queda fuera de pantalla en móvil.
  useEffect(() => {
    if (composerDayId) composerRef.current?.scrollIntoView({ behavior:'smooth', block:'center' })
  }, [composerDayId, editingActivityId])

  // Autocompletado del campo "Ciudad o lugar" del día: sugiere lugares reales
  // del mapa (ciudades, pueblos, parques, paradas) para no escribir mal el
  // nombre. Al elegir uno guardamos sus coordenadas exactas en la caché de
  // geocoding (rememberPlace) para que el ancla del día sea precisa.
  const changeDayCity = value => {
    setDayForm(current => ({ ...current, city:value }))
    clearTimeout(daySpotTimer.current)
    if (value.trim().length < 2) { setDaySpots([]); return }
    daySpotTimer.current = setTimeout(async () => {
      setDaySpotsBusy(true)
      try { setDaySpots(await searchSpots(value)) } catch { setDaySpots([]) }
      setDaySpotsBusy(false)
    }, 350)
  }

  const chooseDaySpot = spot => {
    rememberPlace(spot.name, spot.latitude, spot.longitude, spot.label)
    setDayForm(current => ({ ...current, city:spot.name }))
    setDaySpots([])
  }

  // Limpia sugerencias y timer cuando se cierra el modal o se desmonta.
  useEffect(() => { if (!showDay) { setDaySpots([]); clearTimeout(daySpotTimer.current) } }, [showDay])
  useEffect(() => () => clearTimeout(daySpotTimer.current), [])

  // Avisa al workspace para que oculte nav + FAB mientras el picker o el
  // generador de itinerario están abiertos (ambos son pantallas completas).
  useEffect(() => {
    onPickerChange?.(Boolean(picker) || Boolean(generator))
    return () => onPickerChange?.(false)
  }, [picker, generator, onPickerChange])

  const openGenerator = dayIds => { closeComposer(); setGenerator({ dayIds }) }

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
    setMenuActivityId(null)
    setActForm(emptyActivity)
  }

  const openComposer = (day, category = 'culture', name = '') => {
    setEditingActivityId(null)
    setComposerDayId(day.id)
    setActForm({ ...emptyActivity, category, name, time:suggestNextTime(day.activities) })
  }

  const openPicker = (day, intent = 'top', view = 'list') => {
    closeComposer()
    setPicker({ dayId:day.id, intent, view })
  }

  const editActivity = (day, activity) => {
    setEditingActivityId(activity.id)
    setComposerDayId(day.id)
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

  // Check-in se agrega directo porque el hotel ya trae dirección y coordenadas
  // (no gasta cuota de Tripadvisor). Traslado y "a mano" abren el composer.
  const addCheckin = day => {
    const hotel = dayHotel(day, activeTrip.hotels)
    if (!hotel) return
    addActivity(day.id, { ...emptyActivity, name:`Check-in ${hotel.name}`, category:'transport', time:'15:00', address:hotel.address || hotel.city, latitude:hotel.latitude, longitude:hotel.longitude })
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
        <div className="route-heading-actions">
          {activeTrip.days.length > 0 && (
            <button className="ghost-btn compact gen-trigger" onClick={() => openGenerator(activeTrip.days.map(day => day.id))}>Autogenerar ✦</button>
          )}
          <button className="primary-btn compact" onClick={() => openDayForm()}>+ Día</button>
        </div>
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
              {day.activities.length > 0 && (() => {
                const load = dayLoad(day.activities)
                return (
                  <div className={`day-load level-${load.level}`}>
                    <b>≈ {formatMinutes(load.totalMinutes)}</b>
                    <span>{load.count} parada{load.count !== 1 ? 's' : ''}{load.travelMinutes > 0 ? ` · ${formatMinutes(load.travelMinutes)} en traslados` : ''}</span>
                    {load.level === 'full' && <em>día completo</em>}
                    {load.level === 'over' && <em>día muy cargado</em>}
                  </div>
                )
              })()}
              <div className="activity-timeline">
                {day.activities.map((activity, activityIndex) => {
                  const category = categoryFor(activity.category)
                  const nextActivity = day.activities[activityIndex + 1]
                  const hop = nextActivity ? travelEstimate(activity, nextActivity) : null
                  return (
                    <Fragment key={activity.id}>
                    <div className={`activity-line category-${category.id}`}>
                      <div className="activity-category-icon">
                        {activity.imageUrl
                          ? <img src={activity.imageUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} />
                          : <CategoryIcon name={category.id} />}
                      </div>
                      <button type="button" className="activity-copy" onClick={() => editActivity(day, activity)}>
                        <span>{[activity.time || 'Sin hora', activity.duration, category.label].filter(Boolean).join(' · ')}</span>
                        <h4>{activity.name}</h4>
                        {(activity.address || activity.priceLabel || activity.expenseAmount > 0) && <small>{[activity.address, activity.expenseAmount > 0 ? `💰 ${activity.expenseAmount} ${activity.expenseCurrency}` : activity.priceLabel].filter(Boolean).join(' · ')}</small>}
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
                    {hop && (
                      <div className="activity-hop"><span>{hop.mode === 'walk' ? '🚶' : '🚗'} {formatKm(hop.km)} · {formatMinutes(hop.minutes)}</span></div>
                    )}
                    </Fragment>
                  )
                })}
              </div>

              {composerDayId !== day.id && (
                <div className="route-actions">
                  <button className="add-panorama-btn" onClick={() => openPicker(day)}>
                    <span>+</span><div><b>Agregar panorama</b><small>Lugares reales en {day.city}</small></div>
                  </button>
                  <button className="gen-day-btn" onClick={() => openGenerator([day.id])}>
                    <span>✦</span><div><b>Generar itinerario</b><small>La IA arma el día en {day.city}</small></div>
                  </button>
                  <div className="route-secondary">
                    <button onClick={() => openPicker(day, 'top', 'map')}>Explorar mapa</button>
                    {dayHotel(day, activeTrip.hotels) && (
                      <button onClick={() => addCheckin(day)}>Check-in hotel</button>
                    )}
                    <button onClick={() => openComposer(day, 'transport', 'Traslado')}>Traslado</button>
                    <button onClick={() => openComposer(day)}>A mano</button>
                  </div>
                </div>
              )}

              {composerDayId === day.id && (
                <form ref={composerRef} className="activity-composer" onSubmit={event => createActivity(event, day.id)}>
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
                    <button type="button" className="inspiration-link" onClick={() => openPicker(day, intentForCategory(actForm.category))}>Buscar lugares reales</button>
                    <button className="primary-btn compact">{editingActivityId ? 'Guardar cambios' : 'Agregar a la ruta'}</button>
                  </div>
                </form>
              )}

              <button className="danger-link" onClick={() => removeDay(day)}>Eliminar día</button>
            </div>
          )}
        </article>
      ))}

      {picker && (() => {
        const pickerDay = activeTrip.days.find(day => day.id === picker.dayId)
        if (!pickerDay) return null
        // Portal a document.body: el picker es position:fixed y debe cubrir toda
        // la pantalla. Dentro de .workspace (fixed + overflow:hidden) iOS Safari
        // lo recortaba y dejaba ver la barra inferior abajo (la "banda vacía").
        return createPortal(
          <Suspense fallback={null}>
            <PlacePicker
              day={pickerDay}
              initialIntent={picker.intent}
              initialView={picker.view}
              onClose={() => setPicker(null)}
            />
          </Suspense>,
          document.body
        )
      })()}

      {generator && (
        <Suspense fallback={null}>
          <ItineraryGenerator dayIds={generator.dayIds} onClose={() => setGenerator(null)} />
        </Suspense>
      )}

      {showDay && (
        <div className="modal-backdrop" onClick={() => setShowDay(false)}>
          <form className="modal-card" onSubmit={createDay} onClick={event => event.stopPropagation()}>
            <h2>{editingDayId ? 'Editar día' : 'Agregar día'}</h2>
            <label className="autocomplete-field">Ciudad o lugar
              <input autoFocus required autoComplete="off" value={dayForm.city}
                onChange={e => changeDayCity(e.target.value)}
                placeholder="Ciudad, pueblo, parque, parada..." />
              {(daySpotsBusy || daySpots.length > 0) && (
                <div className="autocomplete-results">
                  {daySpotsBusy
                    ? <span>Buscando lugares...</span>
                    : daySpots.map(spot => (
                        <button type="button" key={spot.id} onClick={() => chooseDaySpot(spot)}>
                          {spot.name}
                          {spot.hint && <small>{spot.hint}</small>}
                        </button>
                      ))}
                </div>
              )}
            </label>
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
