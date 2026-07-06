import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTrips } from '../state/TripContext.jsx'
import { useAuth } from '../state/AuthContext.jsx'
import CategoryIcon, { categoryFor, pinHtml } from './CategoryIcon.jsx'
import { inferCategory, intentFor, intents } from '../lib/intents.js'
import { dayAnchor, dayLoad, formatMinutes, hasMeal, suggestMealTime, suggestNextTime } from '../lib/planner.js'
import { distanceKm, searchSpots, rememberPlace, reverseSpot } from '../lib/geo.js'
import { resolveSplit } from '../lib/computeBalances.js'
import MultiSelect from './MultiSelect.jsx'
import { PRICE_LEVELS, RATING_STEPS, priceLevelCount } from '../lib/placeFilters.js'
import SplitEditor from './SplitEditor.jsx'

const isExternalId = locationId => Boolean(locationId) && !String(locationId).startsWith('local-')
const isTripadvisorId = locationId => isExternalId(locationId) && !String(locationId).startsWith('wiki-') && !String(locationId).startsWith('osm-')
const hasCoords = place => place.latitude != null && place.longitude != null
const placeKey = place => place.locationId || place.tripadvisorUrl || place.name
const fmtDistance = km => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`

export default function PlacePicker({ day, initialIntent = 'top', initialView = 'list', onClose }) {
  const { activeTrip, addActivity, searchPlaces, searchNearbyPlaces, fetchPlacePhoto, addDayStop, removeDayStop } = useTrips()
  const { user } = useAuth()
  // Paradas del día (otras ciudades/pueblos/parques de paso): location[0] es la
  // ciudad del día; el resto son las paradas guardadas. La activa ancla la búsqueda.
  // Ubicaciones del día para las sugerencias: origen (ciudad) → paradas de paso →
  // destino (kind:'destination'). La activa ancla la búsqueda ahí.
  const allStops = activeTrip.preferences?.dayStops?.[day.id] || []
  const routeStops = allStops.filter(item => item.kind !== 'destination')
  const dayDestination = allStops.find(item => item.kind === 'destination') || null
  const locations = [
    { name:day.city, stop:false },
    ...routeStops.map(stop => ({ name:stop.name, latitude:stop.latitude, longitude:stop.longitude, stop:true })),
    ...(dayDestination ? [{ name:dayDestination.name, latitude:dayDestination.latitude, longitude:dayDestination.longitude, stop:true, destination:true }] : [])
  ]
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
  // Filtros: tipo/categoría (afina la búsqueda), precio y puntuación (del lado
  // cliente sobre los resultados ya traídos).
  const [filterTypes, setFilterTypes] = useState([])
  const [priceLevels, setPriceLevels] = useState([])
  const [minRating, setMinRating] = useState(0)
  const [showUnrated, setShowUnrated] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [limitMsg, setLimitMsg] = useState('')
  const [activeLoc, setActiveLoc] = useState(0)
  const [addingStop, setAddingStop] = useState(false)
  const [stopQuery, setStopQuery] = useState('')
  const [stopResults, setStopResults] = useState([])
  const [stopBusy, setStopBusy] = useState(false)
  const stopTimer = useRef(null)
  // Mapa: panel de resultados plegable (más mapa) y punto elegido al tocar el mapa.
  const [mapSheetOpen, setMapSheetOpen] = useState(false)
  const [mapPick, setMapPick] = useState(null)
  const photosRef = useRef({})
  const panelRef = useRef(null)
  const filterOverlayRef = useRef(null)
  const mapElRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(null)
  const markerByKey = useRef({})
  const fitSignatureRef = useRef('')
  const lastProgrammaticMove = useRef(0)
  const searchTimer = useRef(null)
  const requestSeq = useRef(0)

  const intent = intentFor(intentKey)
  const effectiveAnchor = geoAnchor || anchor
  const activeLocation = locations[activeLoc] || locations[0]
  const activeLocationName = activeLocation?.name || day.city

  const togglePrice = id => setPriceLevels(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  const clearFilters = () => { setFilterTypes([]); setPriceLevels([]); setMinRating(0); setShowUnrated(false) }
  const activeFilterCount = filterTypes.length + (priceLevels.length ? 1 : 0) + (minRating > 0 ? 1 : 0)
  const filtersActive = minRating > 0 || priceLevels.length > 0

  // Precio/puntuación filtran sobre lo ya traído (Tripadvisor no filtra por eso).
  // Los lugares sin reseñas (Wikipedia sin enriquecer) se ocultan bajo filtro,
  // salvo que el usuario los pida con "mostrar sin reseñas".
  const visiblePlaces = useMemo(() => {
    if (!filtersActive) return places
    return places.filter(place => {
      const rating = place.rating == null ? null : Number(place.rating)
      const price = priceLevelCount(place.priceLevel)
      const hasMeta = rating != null || price > 0
      if (!hasMeta) return showUnrated
      if (minRating > 0 && (rating == null || rating < minRating)) return false
      if (priceLevels.length && price > 0 && !priceLevels.includes(Math.min(price, 4))) return false
      return true
    })
  }, [places, minRating, priceLevels, showUnrated, filtersActive])

  // Lugares sin rating ni precio (Wikipedia sin enriquecer) que un filtro de
  // precio/puntuación oculta — se ofrecen con "mostrar sin reseñas".
  const unratedCount = places.filter(place => place.rating == null && !priceLevelCount(place.priceLevel)).length

  useEffect(() => {
    if (geoAnchor) return
    const loc = locations[activeLoc]
    if (loc?.stop && loc.latitude != null && loc.longitude != null) {
      setAnchor({ latitude:loc.latitude, longitude:loc.longitude, label:loc.name })
      return
    }
    let alive = true
    dayAnchor(day, activeTrip.hotels).then(point => { if (alive) setAnchor(point) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.id, geoAnchor, activeLoc])

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

  const changeStopQuery = value => {
    setStopQuery(value)
    clearTimeout(stopTimer.current)
    if (value.trim().length < 2) { setStopResults([]); return }
    stopTimer.current = setTimeout(async () => {
      setStopBusy(true)
      try { setStopResults(await searchSpots(value)) } catch { setStopResults([]) }
      setStopBusy(false)
    }, 350)
  }

  const chooseStop = async spot => {
    rememberPlace(spot.name, spot.latitude, spot.longitude, spot.label)
    const newIndex = routeStops.length + 1
    setAddingStop(false); setStopQuery(''); setStopResults([])
    const result = await addDayStop(day.id, spot)
    if (result !== null) { setGeoAnchor(null); setActiveLoc(newIndex) }
  }

  const handleRemoveStop = async (stopName, index) => {
    await removeDayStop(day.id, stopName)
    setActiveLoc(current => (current === index ? 0 : current > index ? current - 1 : current))
  }

  const addPickAsStop = async () => {
    if (!mapPick || mapPick.loading) return
    const pick = mapPick
    setMapPick(null)
    rememberPlace(pick.name, pick.latitude, pick.longitude, pick.label)
    const newIndex = routeStops.length + 1
    const result = await addDayStop(day.id, { name:pick.name, latitude:pick.latitude, longitude:pick.longitude, label:pick.label })
    if (result !== null) { setGeoAnchor(null); setActiveLoc(newIndex) }
  }

  const searchPickArea = () => {
    if (!mapPick) return
    const clean = query.trim()
    lastProgrammaticMove.current = Date.now()
    mapRef.current?.setView([mapPick.latitude, mapPick.longitude], 12)
    runSearch({ text:clean.length >= 3 ? clean : '', area:{ latitude:mapPick.latitude, longitude:mapPick.longitude, radiusKm:15 } })
    setMapPick(null)
  }

  // El panel se renderiza en un portal a document.body y es position:fixed
  // top:0/bottom:0, así que cubre toda la pantalla. NO ajustamos su alto con
  // visualViewport: al abrir el teclado de iOS eso lo encogía y dejaba ver el
  // workspace por debajo. Con el panel a pantalla completa, el teclado lo
  // tapa por abajo y los resultados (.picker-results) siguen scrolleando arriba.

  // El sheet de filtros también debe quedar sobre el teclado: cuando está abierto,
  // fijamos su alto al de la ventana visible (visualViewport) para que el desplegable
  // "Tipo de lugar" no rompa la vista al enfocar su buscador.
  useEffect(() => {
    if (!filtersOpen) return
    const viewport = window.visualViewport
    const overlay = filterOverlayRef.current
    if (!viewport || !overlay) return
    const sync = () => { overlay.style.height = `${Math.round(viewport.height)}px`; overlay.style.bottom = 'auto' }
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      overlay.style.height = ''
      overlay.style.bottom = ''
    }
  }, [filtersOpen])

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
    setLimitMsg('')
    // El filtro de tipo (cocina/museos/etc.) se suma a la búsqueda como texto.
    const typeQuery = filterTypes.join(' ')
    const userText = text.trim()
    const combined = [userText, typeQuery].filter(Boolean).join(' ')
    let result
    let label
    if (area && !combined) {
      // Zona del mapa sin texto ni tipo → browse cercano.
      result = await searchNearbyPlaces({
        latitude:area.latitude,
        longitude:area.longitude,
        radiusKm:area.radiusKm,
        category:intent.category,
        city:day.city,
        fallbackQuery:intent.seedQuery,
        limit:8,
        enrich:true
      })
      label = 'Resultados en esta zona'
    } else if (area) {
      // Zona del mapa + texto/tipo: anclada al centro visible, sin ciudad.
      result = await searchPlaces(combined, '', intent.category, {
        latitude:area.latitude,
        longitude:area.longitude,
        radiusKm:area.radiusKm,
        limit:8,
        enrich:true
      })
      label = 'Resultados en esta zona'
    } else {
      const isSeed = seed && !combined
      const options = { seed:isSeed, limit:8, enrich:true }
      // La búsqueda se ancla a la UBICACIÓN ACTIVA (la ciudad del día o la parada
      // seleccionada), no global. Para agregar paradas en ruta (Valley of Fire en
      // un día de Zion), el usuario agrega la parada y la elige aquí: las coords y
      // el nombre pasan a ser los de esa parada, así sus panoramas sí aparecen.
      if (effectiveAnchor) {
        options.latitude = effectiveAnchor.latitude
        options.longitude = effectiveAnchor.longitude
        options.radiusKm = isSeed ? 15 : 30
      }
      const cityForSearch = geoAnchor ? '' : activeLocationName
      result = await searchPlaces(isSeed ? intent.seedQuery : combined, cityForSearch, intent.category, options)
      label = isSeed || !userText ? `${intent.suggestTitle} en ${activeLocationName}` : `Resultados para “${userText}”`
    }
    if (seq !== requestSeq.current) return
    setBusy(false)
    if (result?.limitReached) {
      setPlaces([])
      setProvider('')
      setResultsLabel('')
      setLimitMsg(result.error || 'Alcanzaste tu cuota mensual de búsquedas de lugares (Tripadvisor). Se renueva el día 1 del próximo mes.')
    } else if (result) {
      setPlaces(result.places || [])
      setProvider(result.provider || '')
      setResultsLabel(label)
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
      // Sin texto: seed (o búsqueda por tipo si hay filtro). Pequeño debounce para
      // agrupar toques rápidos de los chips de tipo.
      searchTimer.current = setTimeout(() => runSearch({ seed:true }), 250)
    }
    return () => clearTimeout(searchTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAnchor, intentKey, query, filterTypes])

  // Foto por resultado (modo generoso: una por tarjeta visible). Se piden una
  // sola vez por locationId en la sesión (photosRef) y se cachean en TripContext.
  useEffect(() => {
    visiblePlaces.forEach(place => {
      const locationId = place.locationId
      if (!isExternalId(locationId) || photosRef.current[locationId]) return
      photosRef.current[locationId] = true
      // Wikipedia/OpenTripMap ya traen la foto en el resultado; solo Tripadvisor
      // requiere una llamada extra (que gasta cuota).
      if (place.imageUrl) { setPhotos(prev => ({ ...prev, [locationId]:place.imageUrl })); return }
      if (isTripadvisorId(locationId)) fetchPlacePhoto(locationId).then(url => setPhotos(prev => ({ ...prev, [locationId]:url })))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePlaces])

  useEffect(() => {
    if (view !== 'map' || !mapElRef.current) return
    const map = L.map(mapElRef.current)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map)
    markersRef.current = L.layerGroup().addTo(map)
    markerByKey.current = {}
    fitSignatureRef.current = ''
    lastProgrammaticMove.current = Date.now()
    map.setView(effectiveAnchor ? [effectiveAnchor.latitude, effectiveAnchor.longitude] : [20, 0], effectiveAnchor ? 13 : 2)
    map.on('moveend', () => {
      if (Date.now() - lastProgrammaticMove.current < 800) return
      setAreaSearch(true)
    })
    // Tocar el mapa (no un pin): resolvemos el lugar más cercano para poder
    // agregarlo como parada o buscar ahí, sin tener que escribirlo.
    map.on('click', async event => {
      const { lat, lng } = event.latlng
      setMapPick({ latitude:lat, longitude:lng, name:'', label:'', loading:true })
      const spot = await reverseSpot(lat, lng)
      setMapPick(current => (current && current.latitude === lat && current.longitude === lng)
        ? { latitude:lat, longitude:lng, name:spot?.name || 'Este punto', label:spot?.label || '', loading:false }
        : current)
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
    markerByKey.current = {}
    const located = visiblePlaces.filter(hasCoords)
    located.forEach((place, index) => {
      const key = placeKey(place)
      const category = categoryFor(inferCategory(place, intent.category))
      const icon = L.divIcon({ className:'poi-pin-wrap', html:pinHtml(category.id, index + 1), iconSize:[32, 32], iconAnchor:[16, 16] })
      const marker = L.marker([place.latitude, place.longitude], { icon })
        .on('click', () => {
          setActiveKey(key)
          setMapSheetOpen(true)
          lastProgrammaticMove.current = Date.now()
          map.panTo([place.latitude, place.longitude])
          setTimeout(() => document.getElementById(`picker-map-card-${index}`)?.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' }), 60)
        })
        .addTo(layer)
      markerByKey.current[key] = marker
    })
    // Solo reencuadrar cuando cambia el CONJUNTO de lugares ubicados, no en cada
    // render: así un cambio de filtro o la llegada de fotos no saca la cámara del
    // pin que el usuario está mirando.
    const signature = located.map(placeKey).join('|')
    if (located.length && signature !== fitSignatureRef.current) {
      lastProgrammaticMove.current = Date.now()
      map.fitBounds(located.map(place => [place.latitude, place.longitude]), { padding:[34, 34], maxZoom:15 })
    }
    fitSignatureRef.current = signature
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePlaces, view])

  // Resalta el pin del lugar activo sin reconstruir los marcadores (reconstruir
  // dispararía fitBounds). Se reaplica también tras cada rebuild —por eso depende
  // de visiblePlaces/view— y siempre con guarda de null en getElement().
  useEffect(() => {
    Object.entries(markerByKey.current).forEach(([key, marker]) => {
      const element = marker.getElement?.()
      if (element) element.classList.toggle('active', key === activeKey)
    })
  }, [activeKey, visiblePlaces, view])

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
    tripadvisorLocationId:place && isTripadvisorId(place.locationId) ? place.locationId : '',
    imageUrl:place ? (photos[place.locationId] || place.imageUrl || '') : '',
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

  const located = visiblePlaces.filter(hasCoords)

  // "Tu día" en vivo: cuántos panoramas lleva, cuánto tiempo y qué le falta. Se
  // recalcula con cada panorama que agregas (day llega actualizado desde RouteTab).
  const dayActivities = day.activities || []
  const dayLoadInfo = dayLoad(dayActivities)
  const mealMissing = dayActivities.length > 0 && !hasMeal(dayActivities) && intentKey !== 'eat'
  const dayStrip = (
    <div className={`picker-day-strip level-${dayLoadInfo.level}`}>
      <div className="pds-main">
        {dayActivities.length === 0
          ? <b>Tu día está vacío — empieza por lo imperdible ✦</b>
          : (<>
              <b>{dayActivities.length} en el día</b>
              <span>≈ {formatMinutes(dayLoadInfo.totalMinutes)}</span>
            </>)}
        {dayLoadInfo.level === 'full' && <em>día completo</em>}
        {dayLoadInfo.level === 'over' && <em>día muy cargado</em>}
      </div>
      {mealMissing && (
        <button type="button" className="pds-nudge" onClick={() => { setIntentKey('eat'); setQuery(''); setFilterTypes([]) }}>🍽 Falta dónde comer</button>
      )}
    </div>
  )

  // Selector de ubicación (ciudad del día + paradas + "agregar parada"). Se usa
  // tanto en la vista Lista como en la del Mapa para poder agregar paradas en ambas.
  const locationSelector = (
    <>
      <div className="picker-locations">
        {locations.map((loc, index) => (
          <span key={`${loc.name}-${index}`} className={`picker-loc-chip ${activeLoc === index && !geoAnchor ? 'active' : ''}`}>
            <button type="button" onClick={() => { setGeoAnchor(null); setActiveLoc(index) }}>{loc.destination ? '🏁 ' : loc.stop ? '📍 ' : ''}{loc.name}</button>
            {loc.stop && <button type="button" className="picker-loc-remove" aria-label={`Quitar ${loc.name}`} onClick={() => handleRemoveStop(loc.name, index)}>✕</button>}
          </span>
        ))}
        {!addingStop && <button type="button" className="picker-loc-add" onClick={() => setAddingStop(true)}>+ Parada</button>}
      </div>
      {addingStop && (
        <div className="picker-stop-search">
          <input
            autoFocus
            value={stopQuery}
            onChange={event => changeStopQuery(event.target.value)}
            placeholder="Ciudad, pueblo o parque de paso…"
            aria-label="Buscar parada"
          />
          <button type="button" className="icon-btn" onClick={() => { setAddingStop(false); setStopQuery(''); setStopResults([]) }} aria-label="Cancelar parada">✕</button>
          {(stopBusy || stopResults.length > 0) && (
            <div className="autocomplete-results">
              {stopBusy ? <span>Buscando lugares…</span> : stopResults.map(spot => (
                <button type="button" key={spot.id} onClick={() => chooseStop(spot)}>
                  <b>{spot.name}</b><small>{spot.hint || spot.label}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className={`place-picker ${view === 'map' ? 'is-map' : ''}`} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="picker-title" aria-label={intent.title} tabIndex={-1}>
      {view === 'list' && (<>
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
              onClick={() => { setIntentKey(item.key); setQuery(''); setFilterTypes([]) }}
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
        {locationSelector}
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
        <div className="picker-filters">
          <button type="button" className={`picker-filter-btn ${activeFilterCount ? 'on' : ''}`} onClick={() => setFiltersOpen(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
            Filtros{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </button>
          {filterTypes.map(type => (
            <button type="button" key={type} className="picker-filter-chip" onClick={() => setFilterTypes(list => list.filter(item => item !== type))}>{type} ✕</button>
          ))}
          {priceLevels.length > 0 && (
            <button type="button" className="picker-filter-chip" onClick={() => setPriceLevels([])}>
              {[...priceLevels].sort((a, b) => a - b).map(level => '$'.repeat(level)).join(' / ')} ✕
            </button>
          )}
          {minRating > 0 && (
            <button type="button" className="picker-filter-chip" onClick={() => setMinRating(0)}>★ {minRating}+ ✕</button>
          )}
        </div>
      </div>
      </>)}

      {view === 'list' ? (
        <div className={`picker-results ${busy ? 'is-busy' : ''}`} aria-live="polite" aria-busy={busy}>
          {dayStrip}
          {busy && !places.length && <div className="ideas-loading">Buscando buenas opciones…</div>}
          {resultsLabel && (visiblePlaces.length > 0 || !busy) && <p className="picker-results-label">{resultsLabel}</p>}
          {visiblePlaces.map((place, index) => {
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
                  {(place.tripadvisorUrl || place.url) && <a href={place.tripadvisorUrl || place.url} target="_blank" rel="noreferrer">Ver detalles ↗</a>}
                  <button type="button" className="picker-tune-btn" onClick={() => openConfirm(place)}>Ajustar</button>
                  <button type="button" className={added ? 'added' : ''} onClick={() => quickAdd(place)} disabled={added}>
                    {added ? '✓ Agregado' : '+ Agregar'}
                  </button>
                </div>
              </article>
            )
          })}
          {!busy && limitMsg && (
            <div className="picker-empty">{limitMsg}</div>
          )}
          {!busy && !limitMsg && !places.length && (
            <div className="picker-empty">
              {failed
                ? 'No pudimos buscar ahora. Revisa tu conexión o agrega el panorama sin lugar.'
                : 'Sin resultados por aquí. Prueba con otra búsqueda o revisa el mapa.'}
            </div>
          )}
          {!busy && places.length > 0 && !visiblePlaces.length && (
            <div className="picker-empty">
              Ningún lugar cumple los filtros.
              <div className="picker-empty-actions">
                {unratedCount > 0 && !showUnrated && (
                  <button type="button" className="picker-relax-btn ghost" onClick={() => setShowUnrated(true)}>Mostrar sin reseñas</button>
                )}
                <button type="button" className="picker-relax-btn" onClick={clearFilters}>Limpiar filtros</button>
              </div>
            </div>
          )}
          {!busy && visiblePlaces.length > 0 && filtersActive && !showUnrated && unratedCount > 0 && (
            <button type="button" className="picker-show-unrated" onClick={() => setShowUnrated(true)}>
              Mostrar {unratedCount} lugar{unratedCount > 1 ? 'es' : ''} sin reseñas
            </button>
          )}
          {!busy && provider === 'tripadvisor' && (
            <p className="provider-note">Resultados consultados en vivo en Tripadvisor. Al agregar uno solo guardamos nombre, dirección y ubicación.</p>
          )}
          {!busy && provider === 'wikipedia' && (
            <p className="provider-note">Lugares e imágenes de Wikipedia / Wikimedia Commons · datos abiertos, sin costo.</p>
          )}
          {!busy && provider === 'wikipedia+tripadvisor' && (
            <p className="provider-note">Lugares con foto de Wikipedia y puntuaciones, reseñas y ranking de Tripadvisor consultados en vivo.</p>
          )}
          {!busy && provider === 'openstreetmap' && (
            <p className="provider-note">Tripadvisor no disponible ahora · mostrando lugares de OpenStreetMap (datos abiertos, sin reseñas).</p>
          )}
        </div>
      ) : (
        <div className="picker-map-wrap">
          <div ref={mapElRef} className="picker-map" />
          <div className="map-overlay-top">
            <div className="map-top-bar">
              <button type="button" className="map-fab" onClick={onClose} aria-label="Volver a la ruta">←</button>
              <div className="picker-search map-search">
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder={intent.placeholder} aria-label="Buscar lugares" />
                {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">✕</button>}
              </div>
              <div className="picker-view-toggle">
                <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>Lista</button>
                <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>Mapa</button>
              </div>
            </div>
            <div className="category-picker">
              {intents.map(item => (
                <button type="button" key={item.key} className={intentKey === item.key ? 'active' : ''} onClick={() => { setIntentKey(item.key); setQuery(''); setFilterTypes([]) }}>
                  <CategoryIcon name={item.icon} /><span>{item.label}</span>
                </button>
              ))}
            </div>
            {locationSelector}
            <div className="map-tool-row">
              <button type="button" className={`picker-filter-btn ${activeFilterCount ? 'on' : ''}`} onClick={() => setFiltersOpen(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
                Filtros{activeFilterCount ? ` · ${activeFilterCount}` : ''}
              </button>
              <label className={`picker-geo ${geoAnchor ? 'on' : ''}`}>
                <input type="checkbox" checked={!!geoAnchor} onChange={toggleGeo} disabled={geoBusy} />
                <span>{geoBusy ? 'Ubicando…' : 'Cerca mío'}</span>
              </label>
              {(geoError || effectiveAnchor) && <small className="map-anchor">{geoError || `Cerca de ${effectiveAnchor.label}`}</small>}
            </div>
          </div>
          {areaSearch && !busy && !mapPick && (
            <button type="button" className="picker-area-btn" onClick={searchThisArea}>Buscar en esta zona</button>
          )}
          {busy && <div className="picker-map-note">Buscando buenas opciones…</div>}
          {!busy && !located.length && !mapPick && (
            <div className="picker-map-note">
              {visiblePlaces.length
                ? 'Estos resultados no traen coordenadas; revísalos en la lista.'
                : 'Toca el mapa para elegir un lugar, o muévelo y “Buscar en esta zona”.'}
            </div>
          )}
          {mapPick && (
            <div className="map-pick-prompt">
              <div className="mpp-info">
                <small>Punto del mapa</small>
                <b>{mapPick.loading ? 'Buscando lugar…' : `📍 ${mapPick.name}`}</b>
              </div>
              <div className="mpp-actions">
                <button type="button" onClick={searchPickArea}>Buscar aquí</button>
                <button type="button" className="mpp-primary" disabled={mapPick.loading} onClick={addPickAsStop}>+ Parada</button>
                <button type="button" className="icon-btn" onClick={() => setMapPick(null)} aria-label="Cerrar punto">✕</button>
              </div>
            </div>
          )}
          <div className={`map-bottom-sheet ${mapSheetOpen ? 'open' : ''}`}>
          {dayStrip}
          {located.length > 0 && (
            <button type="button" className="map-sheet-handle" onClick={() => setMapSheetOpen(open => !open)}>
              {mapSheetOpen ? 'Plegar resultados ▾' : `Ver ${located.length} lugar${located.length > 1 ? 'es' : ''} ▴`}
            </button>
          )}
          {mapSheetOpen && located.length > 0 && located.length < visiblePlaces.length && (
            <p className="picker-map-coordless">
              {visiblePlaces.length - located.length} sin ubicación · míralos en la lista
            </p>
          )}
          {mapSheetOpen && located.length > 0 && (
            <div className="picker-map-cards">
              {located.map((place, index) => {
                const added = addedKeys.includes(placeKey(place))
                const active = activeKey === placeKey(place)
                const photo = photos[place.locationId]
                const ratingText = place.rating != null && place.rating !== 0 ? `★ ${Number(place.rating).toFixed(1)}` : ''
                const distance = effectiveAnchor
                  ? distanceKm([effectiveAnchor.latitude, effectiveAnchor.longitude], [place.latitude, place.longitude])
                  : null
                const meta = [ratingText, place.reviewCount ? `${place.reviewCount} opiniones` : '', place.priceLevel, distance != null ? `a ${fmtDistance(distance)}` : '']
                  .filter(Boolean).join(' · ')
                const detailUrl = place.tripadvisorUrl || place.url || ''
                return (
                  <article
                    id={`picker-map-card-${index}`}
                    key={placeKey(place)}
                    className={`picker-map-card ${active ? 'active' : ''}`}
                    onClick={() => {
                      setActiveKey(placeKey(place))
                      lastProgrammaticMove.current = Date.now()
                      mapRef.current?.panTo([place.latitude, place.longitude])
                    }}
                  >
                    <div className="pmc-photo">
                      {photo
                        ? <img src={photo} alt="" loading="lazy" onError={() => setPhotos(prev => ({ ...prev, [place.locationId]:'' }))} />
                        : <CategoryIcon name={inferCategory(place, intent.category)} />}
                      <span className="pmc-index">{index + 1}</span>
                    </div>
                    <div className="pmc-body">
                      <small className="pmc-cat">{categoryFor(inferCategory(place, intent.category)).label}</small>
                      <h5>{place.name}</h5>
                      {meta && <p className="pmc-meta">{meta}</p>}
                      {place.address && <p className="pmc-address">{place.address}</p>}
                      <div className="pmc-actions">
                        {detailUrl && <a href={detailUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>Ver detalles ↗</a>}
                        <button type="button" className="pmc-tune" onClick={event => { event.stopPropagation(); openConfirm(place) }}>Ajustar</button>
                        <button
                          type="button"
                          className={`idea-add ${added ? 'added' : ''}`}
                          disabled={added}
                          onClick={event => { event.stopPropagation(); quickAdd(place) }}
                          aria-label={`Agregar ${place.name}`}
                        >{added ? '✓' : '+'}</button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          {!busy && located.length > 0 && provider === 'openstreetmap' && (
            <p className="picker-map-provider">Lugares de OpenStreetMap · datos abiertos, sin reseñas</p>
          )}
          {!busy && located.length > 0 && provider === 'wikipedia' && (
            <p className="picker-map-provider">Lugares e imágenes de Wikipedia · datos abiertos</p>
          )}
            <button type="button" className="ghost-btn map-add-noplace" onClick={() => openConfirm(null)}>
              {query.trim().length >= 3 ? `Usar “${query.trim()}” sin lugar` : 'Agregar sin lugar'}
            </button>
          </div>
        </div>
      )}

      {view === 'list' && (
      <footer className="picker-footer">
        <button type="button" className="ghost-btn" onClick={() => openConfirm(null)}>
          {query.trim().length >= 3 ? `Usar “${query.trim()}” sin lugar` : 'Agregar sin lugar'}
        </button>
      </footer>
      )}

      {filtersOpen && (
        <div className="picker-confirm" ref={filterOverlayRef} onClick={() => setFiltersOpen(false)}>
          <form className="picker-filter-sheet" onSubmit={event => { event.preventDefault(); setFiltersOpen(false) }} onClick={event => event.stopPropagation()}>
            <div className="composer-heading">
              <div><span>FILTROS</span><h4>{intent.suggestTitle}</h4></div>
              <button type="button" className="icon-btn" onClick={() => setFiltersOpen(false)} aria-label="Cerrar">✕</button>
            </div>
            <label className="gen-label">{intent.filterLabel}</label>
            <MultiSelect options={intent.filterTypes} value={filterTypes} onChange={setFilterTypes} placeholder="Cualquiera" />
            <label className="gen-label">Precio</label>
            <div className="gen-segment">
              {PRICE_LEVELS.map(level => (
                <button type="button" key={level.id} className={priceLevels.includes(level.id) ? 'active' : ''} onClick={() => togglePrice(level.id)}>{level.label}</button>
              ))}
            </div>
            <label className="gen-label">Puntuación</label>
            <div className="gen-segment">
              {RATING_STEPS.map(step => (
                <button type="button" key={step.id} className={minRating === step.id ? 'active' : ''} onClick={() => setMinRating(step.id)}>{step.label}</button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={clearFilters}>Limpiar</button>
              <button type="submit" className="primary-btn compact">Ver resultados</button>
            </div>
          </form>
        </div>
      )}

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
