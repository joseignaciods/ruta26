import { useEffect, useRef, useState } from 'react'

// Dropdown de selección múltiple, colapsado por defecto para no saturar la vista.
// El panel es inline (no absolute) para que no lo recorte el contenedor con
// overflow del formulario; al abrir empuja el contenido y tiene su propio scroll.
export default function MultiSelect({ options, value, onChange, placeholder = 'Cualquiera' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = event => { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const toggle = option => onChange(value.includes(option) ? value.filter(item => item !== option) : [...value, option])
  const summary = value.length === 0
    ? placeholder
    : value.length <= 2 ? value.join(', ') : `${value.length} seleccionadas`
  const clean = query.trim().toLowerCase()
  const visible = clean ? options.filter(option => option.toLowerCase().includes(clean)) : options

  return (
    <div className={`multiselect ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="multiselect-trigger" onClick={() => setOpen(state => !state)} aria-expanded={open}>
        <span className={value.length ? 'has-value' : ''}>{summary}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="multiselect-panel">
          {options.length > 8 && (
            <input
              className="multiselect-search"
              autoFocus
              placeholder="Buscar…"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          )}
          {value.length > 0 && (
            <button type="button" className="multiselect-clear" onClick={() => onChange([])}>Limpiar selección ({value.length})</button>
          )}
          <div className="multiselect-list">
            {visible.map(option => (
              <button
                type="button"
                key={option}
                className={`multiselect-option ${value.includes(option) ? 'checked' : ''}`}
                onClick={() => toggle(option)}
              >
                <span className="ms-check">{value.includes(option) ? '✓' : ''}</span>{option}
              </button>
            ))}
            {!visible.length && <p className="multiselect-empty">Sin coincidencias</p>}
          </div>
        </div>
      )}
    </div>
  )
}
