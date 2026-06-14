import { useEffect, useRef, useState } from 'react'
import { useTrips } from '../state/TripContext.jsx'

const suggestions = [
  'Arma una ruta de 5 días',
  'Busca panoramas imperdibles',
  'Recomienda restaurantes cercanos'
]

const inlineMarkdown = text => {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g)
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*(.+)\*\*$/)
    if (bold) return <strong key={index}>{bold[1]}</strong>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    return part
  })
}

function Markdown({ children }) {
  const lines = String(children || '').split('\n')
  const blocks = []
  let list = []
  const flush = () => {
    if (!list.length) return
    blocks.push(<ul key={`list-${blocks.length}`}>{list.map((line, index) => <li key={index}>{inlineMarkdown(line)}</li>)}</ul>)
    list = []
  }
  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:-|\d+\.)\s+(.+)$/)
    if (match) list.push(match[1])
    else {
      flush()
      if (line) blocks.push(<p key={index}>{inlineMarkdown(line)}</p>)
      else blocks.push(<br key={index} />)
    }
  })
  flush()
  return blocks
}

export default function AssistantChat({ open: controlledOpen, onOpenChange, initialPrompt, onPromptConsumed }) {
  const { activeTrip, askAssistant, loadChat, clearChat, deleteDay, deleteActivity, deleteExpense, deleteHotel, deletePackingItem } = useTrips()
  const [internalOpen, setInternalOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const panelRef = useRef(null)
  const messagesRef = useRef([])
  const sentPromptRef = useRef(null)
  const tripId = activeTrip?.id
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange || setInternalOpen

  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    if (!open || !tripId) return
    loadChat().then(history => setMessages(history || []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tripId])

  useEffect(() => {
    // Al consumirse el prompt el padre lo vacía; reseteamos para permitir re-disparar la misma acción.
    if (!initialPrompt) { sentPromptRef.current = null; return }
    if (!open || sentPromptRef.current === initialPrompt) return
    sentPromptRef.current = initialPrompt
    const prompt = initialPrompt
    // Margen para que el historial alcance a cargar; recién al enviar avisamos al padre,
    // así el cambio de initialPrompt no cancela este envío programado.
    const timer = setTimeout(() => { send(prompt, messagesRef.current); onPromptConsumed?.() }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrompt])

  const handleClear = async () => {
    if (busy) return
    await clearChat()
    sentPromptRef.current = null
    setMessages([])
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, busy])

  useEffect(() => {
    if (!open) return
    const viewport = window.visualViewport
    const syncViewport = () => {
      const panel = panelRef.current
      if (!panel) return
      panel.style.setProperty('--assistant-viewport-height', `${viewport?.height || window.innerHeight}px`)
      panel.style.setProperty('--assistant-viewport-top', `${viewport?.offsetTop || 0}px`)
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block:'end' }))
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
  }, [open])

  if (!activeTrip) return null

  const send = async (prompt, historyOverride) => {
    const clean = (prompt || '').trim()
    if (!clean || busy) return
    const history = historyOverride || messagesRef.current
    setMessages([...history, { role:'user', content:clean }])
    setText('')
    setBusy(true)
    const reply = await askAssistant(clean, history)
    setBusy(false)
    if (reply?.limitReached) {
      setMessages(list => [...list, { role:'assistant', content:reply.error, limitNotice:true }])
      return
    }
    if (reply) {
      setMessages(list => [...list, {
        role:'assistant',
        content:reply.text,
        externalContent:reply.externalContent,
        sources:reply.sources || [],
        placeSuggestions:reply.placeSuggestions || [],
        suggestedReplies:reply.suggestedReplies || [],
        actions:reply.actions || []
      }])
    }
  }

  const choosePlace = place => {
    const factualDetails = [
      `location_id: ${place.locationId}`,
      `nombre: ${place.name}`,
      place.address && `dirección: ${place.address}`,
      place.latitude != null && `latitud: ${place.latitude}`,
      place.longitude != null && `longitud: ${place.longitude}`,
      place.category && `categoría: ${place.category}`,
      place.priceLevel && `nivel de precio: ${place.priceLevel}`
    ].filter(Boolean).join(', ')
    send(`Confirmo que elijo "${place.name}" para reemplazar el panorama mencionado en mi solicitud anterior. Aplica ahora el cambio usando estos datos de Tripadvisor: ${factualDetails}.`)
  }

  const last = messages[messages.length - 1]
  const undoAction = async action => {
    if (action.tool === 'add_day') await deleteDay(action.id)
    if (action.tool === 'add_activity') await deleteActivity(action.parentId, action.id)
    if (action.tool === 'add_expense') await deleteExpense(action.id)
    if (action.tool === 'add_hotel') await deleteHotel(action.id)
    if (action.tool === 'add_packing_item') await deletePackingItem(action.id)
  }

  return (
    <>
      <button className="assistant-fab" onClick={() => setOpen(!open)} aria-label="Asistente de viaje">✦</button>
      {open && (
        <div className="assistant-panel" ref={panelRef}>
          <header className="assistant-header">
            <div><span>ASISTENTE RUTA26</span><h3>{activeTrip.name}</h3></div>
            <div className="assistant-header-actions">
              {messages.length > 0 && <button className="ghost-btn subtle" onClick={handleClear} disabled={busy}>Limpiar</button>}
              <button className="ghost-btn" onClick={() => setOpen(false)}>Cerrar</button>
            </div>
          </header>
          <div className="chat-messages">
            {messages.length === 0 && !busy && (
              <div className="chat-suggestions">
                <p>Pídeme rutas, panoramas, hoteles o registra gastos. Puedo editar el viaje por ti.</p>
                {suggestions.map(item => <button key={item} onClick={() => send(item)}>{item}</button>)}
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`chat-bubble ${message.role} ${message.placeSuggestions?.length ? 'with-places' : ''} ${message.limitNotice ? 'limit-notice' : ''}`}>
                <Markdown>{message.content}</Markdown>
                {message.placeSuggestions?.length > 0 && (
                  <div className="chat-place-list">
                    {message.placeSuggestions.slice(0, 5).map(place => (
                      <article className="chat-place-card" key={place.locationId || place.tripadvisorUrl || place.name}>
                        <div className="chat-place-heading">
                          <div>
                            <small>{place.category || 'Lugar recomendado'}</small>
                            <h4>{place.name}</h4>
                          </div>
                          <div className="chat-place-badges">
                            {place.rating != null && <b>★ {place.rating}</b>}
                            {place.priceLevel && <span title="Rango de precio informado por Tripadvisor">{place.priceLevel}</span>}
                          </div>
                        </div>
                        {(place.ranking || place.reviewCount) && (
                          <p className="chat-place-meta">
                            {[place.ranking, place.reviewCount ? `${place.reviewCount} opiniones` : ''].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {place.address && <p className="chat-place-address">{place.address}</p>}
                        <div className="chat-place-actions">
                          {place.tripadvisorUrl && <a href={place.tripadvisorUrl} target="_blank" rel="noreferrer">Ver detalles ↗</a>}
                          <button type="button" onClick={() => choosePlace(place)} disabled={busy}>Elegir</button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {!message.placeSuggestions?.length && message.sources?.length > 0 && (
                  <div className="chat-sources">
                    <b>Fuentes en Tripadvisor</b>
                    {message.sources.slice(0, 5).map((source, sourceIndex) => (
                      <a href={source} target="_blank" rel="noreferrer" key={source}>Ver lugar {sourceIndex + 1}</a>
                    ))}
                  </div>
                )}
                {message.externalContent && <small className="live-content-note">Datos en vivo · esta respuesta no se guarda</small>}
                {message.actions?.length > 0 && <div className="assistant-actions">{message.actions.map((action, actionIndex) => <div key={`${action.id}-${actionIndex}`}><span>✓ {action.label}</span>{action.tool.startsWith('add_') && <button onClick={() => undoAction(action)}>Deshacer</button>}</div>)}</div>}
              </div>
            ))}
            {!busy && last?.role === 'assistant' && last.suggestedReplies?.length > 0 && (
              <div className="quick-replies">
                {last.suggestedReplies.map(reply => <button key={reply} onClick={() => send(reply)}>{reply}</button>)}
              </div>
            )}
            {busy && <div className="chat-bubble assistant typing">Pensando...</div>}
            <div ref={endRef} />
          </div>
          <form className="chat-input" onSubmit={event => { event.preventDefault(); send(text) }}>
            <input value={text} onChange={event => setText(event.target.value)} placeholder="Escribe al asistente..." disabled={busy} />
            <button className="primary-btn compact" disabled={busy || !text.trim()}>Enviar</button>
          </form>
        </div>
      )}
    </>
  )
}
