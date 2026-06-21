import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTrips } from '../state/TripContext.jsx'
import { useAuth } from '../state/AuthContext.jsx'
import CategoryIcon, { categoryFor, pinHtml } from './CategoryIcon.jsx'
import { inferCategory, intentFor, intents } from '../lib/intents.js'
import { dayAnchor, suggestMealTime, suggestNextTime } from '../lib/planner.js'
import { distanceKm } from '../lib/geo.js'
import { resolveSplit } from '../lib/computeBalances.js'
import SplitEditor from './SplitEditor.jsx'

const isExternalId = locationId => Boolean(locationId) && !String(locationId).startsWith('local-')
const hasCoords = place => place.latitude != null && place.longitude != null
const placeKey = place => place.locationId || place.tripadvisorUrl || place.name
const fmtDistance = km => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`

export default function PlacePicker({ day, initialIntent = 'top', initialView = 'list', onClose }) {
  const { activeTrip, addActivity, searchPlaces, searchNearbyPlaces, fetchPlacePhoto } = useTrips()
  const { user } = useAuth()
  const expenseMembers = (activeTrip.members || []).filter(member => member.status === 'active')
  const [splitOpen, setSplitOpen] = useState(false)
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
  const [geoAnchor, setGeoAnchor] = useState(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoError, setGeoError] = useState('')
  const [photos, setPhotos] = useState({})
  const photosRef = useRef({})
  const panelRef = useRef(null)
  const mapElRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(null)
  const lastProgrammaticMove = useRef(0)
  const searchTimer = useRef(null)
  const requestSeq = useRef(0)

  const intent = intentFor(intentKey)
  const effectiveAnchor = geoAnchor || anchor

  useEffect(() => {
    if (geoAnchor) return
    let alive = true
    dayAnchor(day, activeTrip.hotels).then(point => { if (alive) setAnchor(point) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.id, geoAnchor])

  const toggleGeo = () => {
    if (geoAnchor) { setGeoAnchor(null); setGeoError(''); return }
    if (!navigator.geolocation) { setGeoError('Tu dispositivo no comparte ubicación'); return }
    setGeoBusy(true)
    setGeoError('')
    navigator.geolocation.getCurrentPosition(
      position => {
        setGeoAnchor({ latitude:position.coords.latitude, longitude:position.coords.longitude, label:'tu ubicación' })
        setGeoBusy(false)
      },
      error => {
        setGeoError(error.code === error.PERMISSION_DENIED ? 'Permiso de ubicación denegado' : 'No pudimos leer tu ubicación')
        setGeoBusy(false)
      },
      { enableHighAccuracy:false, timeout:8000, maximumAge:60000 }
    )
  }

  // El teclado de iOS encoge el visualViewport; el panel se ajusta igual que el asistente.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    // Altura de reposo = la mayor vista observada (sin teclado). Solo encogemos
    // el panel cuando el teclado de iOS reduce visualViewport de forma marcada.
    // Antes comparábamos contra window.innerHeight, que en iOS standalone es
    // >100px mayor en reposo y disparaba un falso positivo dejando hueco abajo.
    let restHeight = viewport.height
    const syncViewport = () => {
      const panel = panelRef.current
      if (!panel) return
      const vpH = viewport.height
      if (vpH > restHeight) restHeight = vpH
      if (vpH < restHeight - 140) {
        panel.style.height = `${vpH}px`
        panel.style.bottom = 'auto'
      } else {
        panel.style.height = ''
        panel.style.bottom = '0'
      }
    }
    const onOrientation = () => { restHeight = 0; setTimeout(syncViewport, 300) }
    syncViewport()
    viewport.addEventListener('resize', syncViewport)
    viewport.addEventListener('scroll', syncViewport)
    window.addEventListener('orientationchange', onOrientation)
    return () => {
      viewport.removeEventListener('resize', syncViewport)
      viewport.removeEventListener('scroll', syncViewport)
      window.removeEventListener('orientationchange', onOrientation)
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
      if (effectiveAnchor) {
        options.latitude = effectiveAnchor.latitude
        options.longitude = effectiveAnchor.longitude
        options.radiusKm = seed ? 15 : 30
      }
      // Si el anchor es GPS no anclamos la búsqueda a la ciudad del día.
      const cityForSearch = geoAnchor ? '' : day.city
      result = await searchPlaces(seed ? intent.seedQuery : text, cityForSearch, intent.category, options)
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
    if (effectiveAnchor === undefined) return
    clearTimeout(searchTimer.current)
    const clean = query.trim()
    if (clean.length >= 3) {
      searchTimer.current = setTimeout(() => runSearch({ text:clean }), 450)
    } else if (!clean.length) {
      runSearch({ seed:true })
    }
    return () => clearTimeout(searchTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAnchor, intentKey, query])

  // Foto por resultado (modo generoso: una por tarjeta visible). Se piden una
  // sola vez por locationId en la sesión (photosRef) y se cachean en TripContext.
  useEffect(() => {
    places.forEach(place => {
      const locationId = place.locationId
      if (!isExternalId(locationId) || photosRef.current[locationId]) return
      photosRef.current[locationId] = true
      fetchPlacePhoto(locationId).then(url => setPhotos(prev => ({ ...prev, [locationId]:url })))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places])

  useEffect(() => {
    if (view !== 'map' || !mapElRef.current) return
    const map = L.map(mapElRef.current)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map)
    markersRef.current = L.layerGroup().addTo(map)
    lastProgrammaticMove.current = Date.now()
    map.setView(effectiveAnchor ? [effectiveAnchor.latitude, effectiveAnchor.longitude] : [20, 0], effectiveAnchor ? 13 : 2)
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
    time:intent.category === 'food'
      ? suggestMealTime(day.activities)
      : (intent.defaultTime || suggestNextTime(day.activities)),
    duration:'',
    address:place?.address || '',
    priceLabel:place?.priceLevel || '',
    latitude:place?.latitude ?? null,
    longitude:place?.longitude ?? null,
    tripadvisorLocationId:place && isExternalId(place.locationId) ? place.locationId : '',
    imageUrl:place && photos[place.locationId] ? photos[place.locationId] : '',
    ...overrides
  })

  const quickAdd = async place => {
    const result = await addActivity(day.id, activityValues(place))
    if (result !== null) setAddedKeys(list => [...list, placeKey(place)])
  }

  const openConfirm = place => {
    const values = activityValues(place)
    setConfirm({ place, name:values.name, time:values.time, duration:'', priceLabel:values.priceLabel, expenseAmount:'', expenseCurrency:activeTrip.currency || 'USD', expensePaidBy:user.id, expenseSplit:{} })
  }

  const submitConfirm = async event => {
    event.preventDefault()
    const amount = Number(confirm.expenseAmount) || 0
    const overrides = { name:confirm.name, time:confirm.time, duration:confirm.duration, priceLabel:confirm.priceLabel }
    if (amount > 0) {
      const activeIds = expenseMembers.map(member => member.userId)
      overrides.expense = { amount, currency:confirm.expenseCurrency, paidBy:confirm.expensePaidBy, split:resolveSplit(confirm.expenseSplit, amount, activeIds) }
    }
    const result = await addActivity(day.id, activityValues(confirm.place, overrides))
    if (result !== null) onClose()
  }

  const located = places.filter(hasCoords)

  return (
    <div className="place-picker" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="picker-title" tabIndex={-1}>
      <header className="picker-header">
        <button type="button" className="back-btn" onClick={onClose} aria-label="Volver a la ruta">←</button>
        <div>
          <span>DÍA {day.position} · {day.city.toUpperCase()}</span>
          <h3 id="picker-title">{intent.title}</h3>
        </div>
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
          <label className={`picker-geo ${geoAnchor ? 'on' : ''}`}>
            <input type="checkbox" checked={!!geoAnchor} onChange={toggleGeo} disabled={geoBusy} />
            <span>{geoBusy ? 'Ubicando…' : 'Cerca mío'}</span>
          </label>
        </div>
        {(geoError || effectiveAnchor) && (
          <small className="picker-anchor">{geoError || `Cerca de ${effectiveAnchor.label}`}</small>
        )}
      </div>

      {view === 'list' ? (
        <div className={`picker-results ${busy ? 'is-busy' : ''}`} aria-live="polite" aria-busy={busy}>
          {busy && !places.length && <div className="ideas-loading">Buscando buenas opciones…</div>}
          {resultsLabel && (places.length > 0 || !busy) && <p className="picker-results-label">{resultsLabel}</p>}
          {places.map((place, index) => {
            const added = addedKeys.includes(placeKey(place))
            const distance = effectiveAnchor && hasCoords(place)
              ? distanceKm([effectiveAnchor.latitude, effectiveAnchor.longitude], [place.latitude, place.longitude])
              : null
            // La primera con foto se muestra como "hero": foto grande y el nombre
            // + rating superpuestos sobre la imagen (estilo Pinterest/Airbnb).
            const hero = index === 0 && isExternalId(place.locationId) && Boolean(photos[place.locationId])
            const ratingText = place.rating != null && place.rating !== 0 ? `★ ${Number(place.rating).toFixed(1)}/5` : ''
            return (
              <article className={`chat-place-card ${hero ? 'is-hero' : ''}`} key={placeKey(place)}>
                {isExternalId(place.locationId) && (
                  <div className="chat-place-photo">
                    {photos[place.locationId]
                      ? <img src={photos[place.locationId]} alt="" loading="lazy" onError={() => setPhotos(prev => ({ ...prev, [place.locationId]:'' }))} />
                      : <CategoryIcon name={inferCategory(place, intent.category)} />}
                    {hero && (
                      <div className="chat-place-hero-overlay">
                        <small>{categoryFor(inferCategory(place, intent.category)).label}</small>
                        <h4>{place.name}</h4>
                        {(ratingText || place.priceLevel) && <span>{[ratingText, place.priceLevel].filter(Boolean).join(' · ')}</span>}
                      </div>
                    )}
                  </div>
                )}
                {!hero && (
                  <div className="chat-place-heading">
                    <div>
                      <small>{categoryFor(inferCategory(place, intent.category)).label}</small>
                      <h4>{place.name}</h4>
                    </div>
                  </div>
                )}
                {!hero && (ratingText || place.priceLevel) ? (
                  <div className="chat-place-badges">
                    {ratingText && <span aria-label={`Calificación ${Number(place.rating).toFixed(1)} de 5`}>{ratingText}</span>}
                    {place.priceLevel && <b title="Rango de precio informado por Tripadvisor">{place.priceLevel}</b>}
                  </div>
                ) : null}
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
            <div className="picker-expense">
              <div className="composer-grid">
                <label>Registrar gasto <span className="optional-label">opcional</span>
                  <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="¿Cuánto costó?" value={confirm.expenseAmount} onChange={event => setConfirm({ ...confirm, expenseAmount:event.target.value })} />
                </label>
                <label>Moneda
                  <input value={confirm.expenseCurrency} onChange={event => setConfirm({ ...confirm, expenseCurrency:event.target.value.toUpperCase() })} />
                </label>
              </div>
              {Number(confirm.expenseAmount) > 0 && expenseMembers.length > 1 && (
                <button type="button" className="split-summary-btn" onClick={() => setSplitOpen(true)}>
                  Pagó {(expenseMembers.find(member => member.userId === confirm.expensePaidBy)?.name) || (expenseMembers.find(member => member.userId === confirm.expensePaidBy)?.email) || 'tú'} · {confirm.expenseSplit?.members?.length ? `entre ${confirm.expenseSplit.members.length}` : 'igual entre todos'} ✎
                </button>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setConfirm(null)}>Volver</button>
              <button className="primary-btn compact">Agregar a la ruta</button>
            </div>
          </form>
        </div>
      )}

      {splitOpen && confirm && (
        <SplitEditor
          amount={Number(confirm.expenseAmount) || 0}
          currency={confirm.expenseCurrency}
          members={expenseMembers}
          currentUserId={user.id}
          value={{ paidBy:confirm.expensePaidBy, split:confirm.expenseSplit }}
          onCancel={() => setSplitOpen(false)}
          onSave={({ paidBy, split }) => { setConfirm(current => ({ ...current, expensePaidBy:paidBy, expenseSplit:split })); setSplitOpen(false) }}
        />
      )}
    </div>
  )
}
