import { useEffect, useMemo, useRef, useState } from 'react'
import { useTrips } from '../state/TripContext.jsx'
import CategoryIcon, { categoryFor } from './CategoryIcon.jsx'
import MultiSelect from './MultiSelect.jsx'
import { CUISINES, CULTURE_TYPES } from '../lib/placeFilters.js'

// Tipos de día (mapean a las claves que entiende la edge function generate-itinerary).
const DAY_TYPES = [
  { id:'culture', label:'Cultura', icon:'culture' },
  { id:'nature', label:'Aire libre', icon:'nature' },
  { id:'entertainment', label:'Experiencias', icon:'entertainment' },
  { id:'food', label:'Gastronomía', icon:'food' }
]
const PACES = [
  { id:'relaxed', label:'Relajado' },
  { id:'balanced', label:'Equilibrado' },
  { id:'intense', label:'Intenso' }
]
const NARRATION = [
  'Buscando panoramas imperdibles…',
  'Eligiendo dónde comer…',
  'Optimizando por cercanía…',
  'Armando tu día ideal…'
]

// El plan editable se mapea 1:1 al shape que espera addActivities.
const toItem = stop => ({
  name:stop.name,
  time:stop.time || '',
  duration:stop.duration || '',
  address:stop.address || '',
  category:stop.category || 'entertainment',
  priceLabel:stop.priceLabel || '',
  latitude:stop.latitude ?? null,
  longitude:stop.longitude ?? null,
  tripadvisorLocationId:stop.tripadvisorLocationId || '',
  imageUrl:stop.imageUrl || ''
})

export default function ItineraryGenerator({ dayIds, onClose }) {
  const { activeTrip, generateItinerary, addActivities, fetchPlacePhoto } = useTrips()
  const allDays = activeTrip?.days || []

  const [selected, setSelected] = useState(() => (dayIds?.length ? dayIds : (allDays[0] ? [allDays[0].id] : [])))
  const [dayTypes, setDayTypes] = useState([])
  const [cuisines, setCuisines] = useState([])
  const [cultureTypes, setCultureTypes] = useState([])
  const [pace, setPace] = useState('balanced')
  const [freeText, setFreeText] = useState('')
  const [avoidUsed, setAvoidUsed] = useState(true)

  const [step, setStep] = useState('config') // config | generating | preview
  const [progress, setProgress] = useState({ current:0, total:0, city:'' })
  const [narration, setNarration] = useState(NARRATION[0])
  const [drafts, setDrafts] = useState([])
  const [activeTab, setActiveTab] = useState(0)
  const [photos, setPhotos] = useState({})
  const [saving, setSaving] = useState(false)

  const panelRef = useRef(null)
  const photosRef = useRef({})
  const narrationTimer = useRef(null)

  const selectedDays = useMemo(
    () => selected.map(id => allDays.find(day => day.id === id)).filter(Boolean),
    [selected, allDays]
  )

  // Modal real: foco al panel, Escape y botón atrás cierran (igual que el picker).
  useEffect(() => {
    panelRef.current?.focus()
    const onKey = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    if (!window.history.state?.generatorOpen) window.history.pushState({ generatorOpen:true }, '')
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Narración rotatoria mientras se genera (la función es buffered, no streamea).
  useEffect(() => {
    if (step !== 'generating') return
    let index = 0
    narrationTimer.current = setInterval(() => {
      index = (index + 1) % NARRATION.length
      setNarration(NARRATION[index])
    }, 1400)
    return () => clearInterval(narrationTimer.current)
  }, [step])

  // Fotos bajo demanda para las paradas de comida (Tripadvisor); las atracciones
  // de Wikipedia ya traen imageUrl gratis.
  useEffect(() => {
    drafts.forEach(draft => draft.stops.forEach(stop => {
      const id = stop.tripadvisorLocationId
      if (!id || stop.imageUrl || photosRef.current[id]) return
      photosRef.current[id] = true
      fetchPlacePhoto(id).then(url => { if (url) setPhotos(prev => ({ ...prev, [id]:url })) })
    }))
  }, [drafts, fetchPlacePhoto])

  const toggleDayType = id => setDayTypes(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  const toggleDay = id => setSelected(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))

  const generate = async () => {
    if (!selectedDays.length) return
    setStep('generating')
    setDrafts([])
    setPhotos({})
    photosRef.current = {}
    const results = []
    const extraExclude = []
    for (let i = 0; i < selectedDays.length; i++) {
      const day = selectedDays[i]
      setProgress({ current:i + 1, total:selectedDays.length, city:day.city })
      const data = await generateItinerary({ dayId:day.id, dayTypes, pace, freeText, avoidUsed, cuisines, cultureTypes, extraExclude })
      const plan = data?.plan
      results.push({
        dayId:day.id,
        position:day.position,
        city:plan?.city || day.city,
        daySummary:plan?.daySummary || '',
        meta:data?.meta || (data ? {} : { failed:true }),
        stops:plan?.stops || []
      })
      ;(plan?.stops || []).forEach(stop => extraExclude.push({
        tripadvisorLocationId:stop.tripadvisorLocationId, name:stop.name, latitude:stop.latitude, longitude:stop.longitude
      }))
    }
    setDrafts(results)
    setActiveTab(0)
    setStep('preview')
  }

  const removeStop = (tabIndex, stopIndex) =>
    setDrafts(list => list.map((draft, i) => i === tabIndex
      ? { ...draft, stops:draft.stops.filter((_, si) => si !== stopIndex) }
      : draft))

  const moveStop = (tabIndex, stopIndex, dir) =>
    setDrafts(list => list.map((draft, i) => {
      if (i !== tabIndex) return draft
      const next = [...draft.stops]
      const target = stopIndex + dir
      if (target < 0 || target >= next.length) return draft
      ;[next[stopIndex], next[target]] = [next[target], next[stopIndex]]
      return { ...draft, stops:next }
    }))

  const save = async () => {
    setSaving(true)
    for (const draft of drafts) {
      if (draft.stops.length) await addActivities(draft.dayId, draft.stops.map(toItem))
    }
    setSaving(false)
    onClose()
  }

  const totalStops = drafts.reduce((sum, draft) => sum + draft.stops.length, 0)
  const headerSub = selectedDays.length > 1
    ? `${selectedDays.length} días`
    : (selectedDays[0]?.city || activeTrip?.name || '')

  return (
    <div className="place-picker itinerary-generator" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="gen-title" tabIndex={-1}>
      <header className="picker-header">
        <button type="button" className="back-btn" onClick={onClose} aria-label="Volver a la ruta">←</button>
        <div>
          <span>ITINERARIO ✦</span>
          <h3 id="gen-title">{step === 'preview' ? 'Tu itinerario' : 'Arma tu día ideal'}</h3>
        </div>
        <small className="gen-header-sub">{headerSub}</small>
      </header>

      {step === 'config' && (
        <div className="gen-config">
          {allDays.length > 1 && (
            <section className="gen-field">
              <label className="gen-label">¿Para qué días?</label>
              <div className="gen-day-chips">
                {allDays.map(day => (
                  <button
                    type="button"
                    key={day.id}
                    className={selected.includes(day.id) ? 'active' : ''}
                    onClick={() => toggleDay(day.id)}
                  >
                    <b>Día {day.position}</b><span>{day.city}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="gen-field">
            <label className="gen-label">Tipo de día <span className="optional-label">opcional</span></label>
            <div className="category-picker gen-types">
              {DAY_TYPES.map(type => (
                <button
                  type="button"
                  key={type.id}
                  className={dayTypes.includes(type.id) ? 'active' : ''}
                  onClick={() => toggleDayType(type.id)}
                >
                  <CategoryIcon name={type.icon} /><span>{type.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="gen-field">
            <label className="gen-label">Cocina <span className="optional-label">opcional</span></label>
            <MultiSelect options={CUISINES} value={cuisines} onChange={setCuisines} placeholder="Cualquier cocina" />
          </section>

          <section className="gen-field">
            <label className="gen-label">Interés cultural <span className="optional-label">opcional</span></label>
            <MultiSelect options={CULTURE_TYPES} value={cultureTypes} onChange={setCultureTypes} placeholder="Cualquiera" />
          </section>

          <section className="gen-field">
            <label className="gen-label">Ritmo</label>
            <div className="gen-segment">
              {PACES.map(option => (
                <button
                  type="button"
                  key={option.id}
                  className={pace === option.id ? 'active' : ''}
                  onClick={() => setPace(option.id)}
                >{option.label}</button>
              ))}
            </div>
          </section>

          <section className="gen-field">
            <label className="gen-label" htmlFor="gen-free">¿Algo especial? <span className="optional-label">opcional</span></label>
            <textarea
              id="gen-free"
              className="gen-textarea"
              rows={2}
              maxLength={400}
              placeholder="Ej: vamos con niños, sin caminar mucho, presupuesto bajo, amantes del café…"
              value={freeText}
              onChange={event => setFreeText(event.target.value)}
            />
          </section>

          <label className="gen-switch">
            <input type="checkbox" checked={avoidUsed} onChange={event => setAvoidUsed(event.target.checked)} />
            <span>Evitar lugares que ya tengo en otros días</span>
          </label>

          <footer className="picker-footer gen-footer">
            <button type="button" className="primary-btn gen-go" disabled={!selectedDays.length} onClick={generate}>
              Generar itinerario ✦
            </button>
            <small>Sin preferencias armamos un día equilibrado con lo mejor de la zona.</small>
          </footer>
        </div>
      )}

      {step === 'generating' && (
        <div className="gen-loading">
          <div className="gen-spinner" aria-hidden="true">✦</div>
          {progress.total > 1 && <p className="gen-progress">Día {progress.current} de {progress.total} · {progress.city}</p>}
          <p className="gen-narration" aria-live="polite">{narration}</p>
          <div className="gen-skeletons">
            {[0, 1, 2, 3].map(i => <div className="gen-skeleton" key={i} />)}
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="gen-preview">
          <div className="gen-preview-banner">Vista previa — aún no se guarda. Ajusta y luego guarda. ✦</div>

          {drafts.length > 1 && (
            <div className="gen-day-tabs">
              {drafts.map((draft, index) => (
                <button
                  type="button"
                  key={draft.dayId}
                  className={activeTab === index ? 'active' : ''}
                  onClick={() => setActiveTab(index)}
                >
                  Día {draft.position}<small>{draft.stops.length}</small>
                </button>
              ))}
            </div>
          )}

          {drafts[activeTab] && (() => {
            const draft = drafts[activeTab]
            const notes = []
            if (draft.meta?.demo) notes.push('Modo demo: ideas de ejemplo (sin IA).')
            if (draft.meta?.taSkipped) notes.push('Sin sugerencias de comida ahora (Tripadvisor no disponible).')
            if (draft.meta?.fewCandidates) notes.push('Pocas opciones por esta zona.')
            if (draft.meta?.excludedCount) notes.push(`Evitamos ${draft.meta.excludedCount} lugar(es) que ya tienes en la ruta.`)
            return (
              <div className="gen-day">
                {draft.daySummary && <p className="gen-day-summary">{draft.daySummary}</p>}
                {notes.length > 0 && <p className="gen-day-note">{notes.join(' ')}</p>}

                {draft.stops.length === 0 ? (
                  <div className="picker-empty">
                    {draft.meta?.failed
                      ? 'No pudimos generar este día. Vuelve a intentar.'
                      : 'No encontramos suficientes lugares por aquí. Prueba otro tipo de día o agrégalos a mano.'}
                  </div>
                ) : (
                  <div className="gen-timeline">
                    {draft.stops.map((stop, stopIndex) => {
                      const category = categoryFor(stop.category)
                      const image = stop.imageUrl || (stop.tripadvisorLocationId && photos[stop.tripadvisorLocationId]) || ''
                      return (
                        <div className={`gen-stop category-${category.id}`} key={`${stop.name}-${stopIndex}`}>
                          <div className="gen-stop-photo">
                            {image
                              ? <img src={image} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} />
                              : <CategoryIcon name={category.id} />}
                          </div>
                          <div className="gen-stop-body">
                            <span className="gen-stop-meta">{[stop.time || 'Sin hora', stop.duration, category.label].filter(Boolean).join(' · ')}</span>
                            <h4>{stop.name}</h4>
                            {stop.sector && <span className="gen-sector">{stop.sector}</span>}
                            {stop.whyPicked && <p className="gen-why">{stop.whyPicked}</p>}
                            {stop.address && <small className="gen-stop-address">{stop.address}</small>}
                          </div>
                          <div className="gen-stop-controls">
                            <button type="button" onClick={() => moveStop(activeTab, stopIndex, -1)} disabled={stopIndex === 0} aria-label="Subir">↑</button>
                            <button type="button" onClick={() => moveStop(activeTab, stopIndex, 1)} disabled={stopIndex === draft.stops.length - 1} aria-label="Bajar">↓</button>
                            <button type="button" onClick={() => removeStop(activeTab, stopIndex)} aria-label="Quitar">✕</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          <footer className="picker-footer gen-preview-footer">
            <button type="button" className="ghost-btn" onClick={onClose}>Descartar</button>
            <button type="button" className="ghost-btn" onClick={() => setStep('config')}>Regenerar</button>
            <button type="button" className="primary-btn" disabled={saving || totalStops === 0} onClick={save}>
              {saving ? 'Guardando…' : `Guardar (${totalStops})`}
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
