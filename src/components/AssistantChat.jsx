import { useEffect, useRef, useState } from 'react'
import { useTrips } from '../state/TripContext.jsx'

const suggestions = [
  'Arma una ruta de 5 días',
  'Busca panoramas imperdibles',
  'Recomienda restaurantes cercanos'
]

export default function AssistantChat({ open: controlledOpen, onOpenChange, initialPrompt, onPromptConsumed }) {
  const { activeTrip, askAssistant, loadChat } = useTrips()
  const [internalOpen, setInternalOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const messagesRef = useRef([])
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
    if (!open || !initialPrompt) return
    const prompt = initialPrompt
    onPromptConsumed?.()
    // Pequeño margen para que el historial alcance a cargar antes de enviar.
    const timer = setTimeout(() => send(prompt, messagesRef.current), 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrompt])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, busy])

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
    if (reply) {
      setMessages(list => [...list, {
        role:'assistant',
        content:reply.text,
        externalContent:reply.externalContent,
        sources:reply.sources || [],
        suggestedReplies:reply.suggestedReplies || []
      }])
    }
  }

  const last = messages[messages.length - 1]

  return (
    <>
      <button className="assistant-fab" onClick={() => setOpen(!open)} aria-label="Asistente de viaje">✦</button>
      {open && (
        <div className="assistant-panel">
          <header className="assistant-header">
            <div><span>ASISTENTE RUTA26</span><h3>{activeTrip.name}</h3></div>
            <button className="ghost-btn" onClick={() => setOpen(false)}>Cerrar</button>
          </header>
          <div className="chat-messages">
            {messages.length === 0 && !busy && (
              <div className="chat-suggestions">
                <p>Pídeme rutas, panoramas, hoteles o registra gastos. Puedo editar el viaje por ti.</p>
                {suggestions.map(item => <button key={item} onClick={() => send(item)}>{item}</button>)}
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`chat-bubble ${message.role}`}>
                {message.content}
                {message.sources?.length > 0 && (
                  <div className="chat-sources">
                    <b>Fuentes en Tripadvisor</b>
                    {message.sources.slice(0, 5).map((source, sourceIndex) => (
                      <a href={source} target="_blank" rel="noreferrer" key={source}>Ver lugar {sourceIndex + 1}</a>
                    ))}
                  </div>
                )}
                {message.externalContent && <small className="live-content-note">Datos en vivo · esta respuesta no se guarda</small>}
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
