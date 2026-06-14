import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTrips } from '../state/TripContext.jsx'
import CategoryIcon, { categoryFor, pinHtml } from './CategoryIcon.jsx'
import { inferCategory, intentFor, intents } from '../lib/intents.js'
import { dayAnchor, suggestNextTime } from '../lib/planner.js'
import { distanceKm } from '../lib/geo.js'

const isExternalId = locationId => Boolean(locationId) && !String(locationId).startsWith('local-')
const hasCoords = place => place.latitude != null && place.longitude != null
const placeKey = place => place.locationId || place.tripadvisorUrl || place.name
const fmtDistance = km => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`

export default function PlacePicker({ day, initialIntent = 'top', initialView = 'list', onClose }) {
  const { activeTrip, addActivity, searchPlaces, searchNearbyPlaces } = useTrips()
  const [intentKey, setIntentKey] = useState(initialIntent)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState([])
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState('')
  const [resultsLabel, setResultsLabel] = useState('')
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState(initialView)
  const [anchor, setAnchor] = useState(undefined)
  const [confirm, setConfirm] = useState(null)
  const [addedKeys, setAddedKeys] = useState([])
  const [areaSearch, setAreaSearch] = useState(false)
  const [activeKey, setActiveKey] = useState(null)
  const panelRef = useRef(null)
  const mapElRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(null)
  const lastProgrammaticMove = useRef(0)
  const searchTimer = useRef(null)
  const requestSeq = useRef(0)

  const intent = intentFor(intentKey)

  useEffect(() => {
    let alive = true
    dayAnchor(day, activeTrip.hotels).then(point => { if (alive) setAnchor(point) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.id])

  // El teclado de iOS encoge el visualViewport; el panel se ajusta igual que el asistente.
  useEffect(() => {
    const viewport = window.visualViewport
    const syncViewport = () => {
      const panel = panelRef.current
      if (!panel) return
      panel.style.setProperty('--picker-viewport-height', `${viewport?.height || window.innerHeight}px`)
      panel.style.setProperty('--picker-viewport-top', `${viewport?.offsetTop || 0}px`)
    }
    syncViewport()
    viewport?.addEventListener('resize', syncViewport)
    viewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('orientationchange', syncViewport)
    return () => {
      viewport?.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('scroll', syncViewport)
      window.removeEventListener('orientationchange', syncViewport)
    }
  }, [])

  // Modal real: foco al panel, Escape cierra, y el botón atrás cierra el picker
  // (no el viaje). Empuja un estado de historial solo si aún no hay uno nuestro,
  // para ser estable bajo StrictMode (doble montaje) y no acumular entradas.
  useEffect(() => {
    const previousFocus = document.activeElement
    panelRef.current?.focus()
    const onKey = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    if (!window.history.state?.pickerOpen) window.history.pushState({ pickerOpen: true }, '')
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = async ({ text = '', seed = false, area = null }) => {
    const seq = ++requestSeq.current
    setBusy(true)
    setAreaSearch(false)
    setFailed(false)
    let result
    if (area && !text) {
      result = await searchNearbyPlaces({
        latitude:area.latitude,
        longitude:area.longitude,
        radiusKm:area.radiusKm,
        category:intent.category,
        city:day.city,
        fallbackQuery:intent.seedQuery,
        limit:8
      })
    } else if (area && text) {
      // Texto + zona del mapa: búsqueda normal anclada al centro visible, sin ciudad
      // para que el área mande sobre el nombre de la ciudad.
      result = await searchPlaces(text, '', intent.category, {
        latitude:area.latitude,
        longitude:area.longitude,
        radiusKm:area.radiusKm,
        limit:8
      })
    } else {
      const options = { seed, limit:8 }
      if (anchor) {
        options.latitude = anchor.latitude
        options.longitude = anchor.longitude
        options.radiusKm = seed ? 15 : 30
      }
      result = await searchPlaces(seed ? intent.seedQuery : text, day.city, intent.category, options)
    }
    if (seq !== requestSeq.current) return
    setBusy(false)
    if (result) {
      setPlaces(result.places || [])
      setProvider(result.provider || '')
      setResultsLabel(area
        ? 'Resultados en esta zona'
        : seed ? `${intent.suggestTitle} en ${day.city}` : `Resultados para “${text}”`)
    } else {
      setPlaces([])
      setProvider('')
      setFailed(true)
      setResultsLabel('')
    }
  }

  // Sugerencias al abrir o cambiar de intención; búsqueda al tipear (3+ letras).
  useEffect(() => {
    if (anchor === undefined) return
    clearTimeout(searchTimer.current)
    const clean = query.trim()
    if (clean.length >= 3) {
      searchTimer.current = setTimeout(() => runSearch({ text:clean }), 450)
    } else if (!clean.length) {
      runSearch({ seed:true })
    }
    return () => clearTimeout(searchTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, intentKey, query])

  useEffect(() => {
    if (view !== 'map' || !mapElRef.current) return
    const map = L.map(mapElRef.current)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map)
    markersRef.current = L.layerGroup().addTo(map)
    lastProgrammaticMove.current = Date.now()
    map.setView(anchor ? [anchor.latitude, anchor.longitude] : [20, 0], anchor ? 13 : 2)
    map.on('moveend', () => {
      if (Date.now() - lastProgrammaticMove.current < 800) return
      setAreaSearch(true)
    })
    setTimeout(() => { mapRef.current === map && map.invalidateSize() }, 60)
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  useEffect(() => {
    const map = mapRef.current
    const layer = markersRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const located = places.filter(hasCoords)
    located.forEach((place, index) => {
      const category = categoryFor(inferCategory(place, intent.category))
      const icon = L.divIcon({ className:'poi-pin-wrap', html:pinHtml(category.id, index + 1), iconSize:[32, 32], iconAnchor:[16, 16] })
      L.marker([place.latitude, place.longitude], { icon })
        .bindTooltip(place.name, { direction:'top' })
        .on('click', () => {
          setActiveKey(placeKey(place))
          document.getElementById(`picker-map-card-${index}`)?.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' })
        })
        .addTo(layer)
    })
    if (located.length) {
      lastProgrammaticMove.current = Date.now()
      map.fitBounds(located.map(place => [place.latitude, place.longitude]), { padding:[34, 34], maxZoom:15 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, view])

  const searchThisArea = () => {
    const map = mapRef.current
    if (!map) return
    const center = map.getCenter()
    const corner = map.getBounds().getNorthEast()
    const radiusKm = Math.min(25, Math.max(1, distanceKm([center.lat, center.lng], [corner.lat, corner.lng])))
    const clean = query.trim()
    runSearch({ text:clean.length >= 3 ? clean : '', area:{ latitude:center.lat, longitude:center.lng, radiusKm } })
  }

  const activityValues = (place, overrides = {}) => ({
    name:place ? place.name : query.trim(),
    category:place ? inferCategory(place, intent.category) : intent.category,
    time:intent.defaultTime || suggestNextTime(day.activities),
    duration:'',
    address:place?.address || '',
    priceLabel:place?.priceLevel || '',
    latitude:place?.latitude ?? null,
    longitude:place?.longitude ?? null,
    tripadvisorLocationId:place && isExternalId(place.locationId) ? place.locationId : '',
    ...overrides
  })

  const quickAdd = async place => {
    const result = await addActivity(day.id, activityValues(place))
    if (result !== null) setAddedKeys(list => [...list, placeKey(place)])
  }

  const openConfirm = place => {
    const values = activityValues(place)
    setConfirm({ place, name:values.name, time:values.time, duration:'', priceLabel:values.priceLabel })
  }

  const submitConfirm = async event => {
    event.preventDefault()
    const result = await addActivity(day.id, activityValues(confirm.place, {
      name:confirm.name,
      time:confirm.time,
      duration:confirm.duration,
      priceLabel:confirm.priceLabel
    }))
    if (result !== null) onClose()
  }

  const located = places.filter(hasCoords)

  return (
    <div className="place-picker" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="picker-title" tabIndex={-1}>
      <header className="picker-header">
        <div>
          <span>DÍA {day.position} · {day.city.toUpperCase()}</span>
          <h3 id="picker-title">{intent.title}</h3>
        </div>
        <button type="button" className="ghost-btn" onClick={onClose}>Cerrar</button>
      </header>

      <div className="picker-controls">
        <div className="category-picker">
          {intents.map(item => (
            <button
              type="button"
              key={item.key}
              className={intentKey === item.key ? 'active' : ''}
              onClick={() => { setIntentKey(item.key); setQuery('') }}
            >
              <CategoryIcon name={item.icon} /><span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="picker-search">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={intent.placeholder}
            aria-label="Buscar lugares"
          />
          {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">✕</button>}
        </div>
        <div className="picker-toolbar">
          <div className="picker-view-toggle">
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>Lista</button>
            <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>Mapa</button>
          </div>
          {anchor && <small className="picker-anchor">Cerca de {anchor.label}</small>}
        </div>
      </div>

      {view === 'list' ? (
        <div className={`picker-results ${busy ? 'is-busy' : ''}`} aria-live="polite" aria-busy={busy}>
          {busy && !places.length && <div className="ideas-loading">Buscando buenas opciones…</div>}
          {resultsLabel && (places.length > 0 || !busy) && <p className="picker-results-label">{resultsLabel}</p>}
          {places.map(place => {
            const added = addedKeys.includes(placeKey(place))
            const distance = anchor && hasCoords(place)
              ? distanceKm([anchor.latitude, anchor.longitude], [place.latitude, place.longitude])
              : null
            return (
              <article className="chat-place-card" key={placeKey(place)}>
                <div className="chat-place-heading">
                  <div>
                    <small>{categoryFor(inferCategory(place, intent.category)).label}</small>
                    <h4>{place.name}</h4>
                  </div>
                  <div className="chat-place-badges">
                    {place.rating != null && place.rating !== 0 && <span aria-label={`Calificación ${Number(place.rating).toFixed(1)} de 5`}>★ {Number(place.rating).toFixed(1)}/5</span>}
                    {place.priceLevel && <b title="Rango de precio informado por Tripadvisor">{place.priceLevel}</b>}
                  </div>
                </div>
                {(place.ranking || place.reviewCount || distance != null) && (
                  <p className="chat-place-meta">
                    {[place.ranking, place.reviewCount ? `${place.reviewCount} opiniones` : '', distance != null ? `a ${fmtDistance(distance)}` : ''].filter(Boolean).join(' · ')}
                  </p>
                )}
                {place.address && <p className="chat-place-address">{place.address}</p>}
                <div className="chat-place-actions">
                  {place.tripadvisorUrl && <a href={place.tripadvisorUrl} target="_blank" rel="noreferrer">Ver detalles ↗</a>}
                  <button type="button" className="picker-tune-btn" onClick={() => openConfirm(place)}>Ajustar</button>
                  <button type="button" className={added ? 'added' : ''} onClick={() => quickAdd(place)} disabled={added}>
                    {added ? '✓ Agregado' : '+ Agregar'}
                  </button>
                </div>
              </article>
            )
          })}
          {!busy && !places.length && (
            <div className="picker-empty">
              {failed
                ? 'No pudimos buscar ahora. Revisa tu conexión o agrega el panorama sin lugar.'
                : 'Sin resultados por aquí. Prueba con otra búsqueda o revisa el mapa.'}
            </div>
          )}
          {!busy && provider === 'tripadvisor' && (
            <p className="provider-note">Resultados consultados en vivo en Tripadvisor. Al agregar uno solo guardamos nombre, dirección y ubicación.</p>
          )}
        </div>
      ) : (
        <div className="picker-map-wrap">
          <div ref={mapElRef} className="picker-map" />
          {areaSearch && !busy && (
            <button type="button" className="picker-area-btn" onClick={searchThisArea}>Buscar en esta zona</button>
          )}
          {busy && <div className="picker-map-note">Buscando buenas opciones…</div>}
          {!busy && !located.length && (
            <div className="picker-map-note">
              {places.length
                ? 'Estos resultados no traen coordenadas; revísalos en la lista.'
                : 'Mueve el mapa y toca “Buscar en esta zona”.'}
            </div>
          )}
          {located.length > 0 && (
            <div className="picker-map-cards">
              {located.map((place, index) => {
                const added = addedKeys.includes(placeKey(place))
                return (
                  <div
                    id={`picker-map-card-${index}`}
                    key={placeKey(place)}
                    className={`picker-map-card ${activeKey === placeKey(place) ? 'active' : ''}`}
                    onClick={() => {
                      setActiveKey(placeKey(place))
                      lastProgrammaticMove.current = Date.now()
                      mapRef.current?.panTo([place.latitude, place.longitude])
                    }}
                  >
                    <b>{index + 1}</b>
                    <div>
                      <h5>{place.name}</h5>
                      <small>{[place.rating ? `★ ${Number(place.rating).toFixed(1)}/5` : '', place.priceLevel].filter(Boolean).join(' · ') || place.address}</small>
                    </div>
                    <button
                      type="button"
                      className={`idea-add ${added ? 'added' : ''}`}
                      disabled={added}
                      onClick={event => { event.stopPropagation(); quickAdd(place) }}
                      aria-label={`Agregar ${place.name}`}
                    >{added ? '✓' : '+'}</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <footer className="picker-footer">
        <button type="button" className="ghost-btn" onClick={() => openConfirm(null)}>
          {query.trim().length >= 3 ? `Usar “${query.trim()}” sin lugar` : 'Agregar sin lugar'}
        </button>
      </footer>

      {confirm && (
        <div className="picker-confirm" onClick={() => setConfirm(null)}>
          <form onSubmit={submitConfirm} onClick={event => event.stopPropagation()}>
            <div className="composer-heading">
              <div>
                <span>NUEVO PANORAMA · DÍA {day.position}</span>
                <h4>{confirm.place ? confirm.place.name : 'Panorama propio'}</h4>
              </div>
              <button type="button" className="icon-btn" onClick={() => setConfirm(null)} aria-label="Cerrar">✕</button>
            </div>
            {confirm.place?.address && (
              <div className="picker-confirm-place">
                <CategoryIcon name={inferCategory(confirm.place, intent.category)} />
                <small>{confirm.place.address}</small>
              </div>
            )}
            <label>Nombre
              <input required value={confirm.name} onChange={event => setConfirm({ ...confirm, name:event.target.value })} />
            </label>
            <div className="composer-grid">
              <label>Hora
                <input type="time" value={confirm.time} onChange={event => setConfirm({ ...confirm, time:event.target.value })} />
              </label>
              <label>Duración
                <input placeholder="Ej. 2h" value={confirm.duration} onChange={event => setConfirm({ ...confirm, duration:event.target.value })} />
              </label>
            </div>
            <label>Precio estimado
              <input placeholder={`Ej. 20 ${activeTrip.currency || 'USD'}`} value={confirm.priceLabel} onChange={event => setConfirm({ ...confirm, priceLabel:event.target.value })} />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setConfirm(null)}>Volver</button>
              <button className="primary-btn compact">Agregar a la ruta</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
