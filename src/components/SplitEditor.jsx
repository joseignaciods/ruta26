import { useMemo, useState } from 'react'
import { equalShares, weightedShares, SETTLE_EPSILON } from '../lib/computeBalances.js'

const round2 = value => Math.round(Number(value || 0) * 100) / 100
const fmt = value => Number(value || 0).toLocaleString('es-CL', { maximumFractionDigits:2 })
const label = member => member.name || member.email || 'Miembro'

const METHODS = [
  { key:'equal', label:'Igual' },
  { key:'shares', label:'Partes' },
  { key:'exact', label:'Exacto' },
  { key:'percent', label:'%' }
]

// Editor de división de un gasto: quién pagó y entre quiénes/cómo se reparte.
// Devuelve { paidBy, split:{ mode, members, amounts, weights } } a onSave.
export default function SplitEditor({ amount, currency, members, currentUserId, value, onCancel, onSave }) {
  const total = Number(amount || 0)
  const ids = members.map(member => member.userId)
  const initial = value?.split || {}
  const initialMembers = initial.members?.length ? initial.members : ids

  const [paidBy, setPaidBy] = useState(value?.paidBy || currentUserId || ids[0])
  const [mode, setMode] = useState(initial.mode || 'equal')
  const [included, setIncluded] = useState(() =>
    Object.fromEntries(ids.map(id => [id, initialMembers.includes(id)])))
  const [weights, setWeights] = useState(() =>
    Object.fromEntries(ids.map(id => [id, String(initial.weights?.[id] ?? 1)])))
  const [exact, setExact] = useState(() =>
    Object.fromEntries(ids.map(id => [id, initial.mode === 'exact' && initial.amounts?.[id] != null ? String(initial.amounts[id]) : ''])))
  const [percent, setPercent] = useState(() =>
    Object.fromEntries(ids.map(id => [id, initial.mode === 'percent' && initial.weights?.[id] != null ? String(initial.weights[id]) : ''])))

  const includedIds = ids.filter(id => included[id])

  const preview = useMemo(() => {
    if (!includedIds.length) return {}
    if (mode === 'equal') return equalShares(total, includedIds)
    if (mode === 'shares') {
      const w = Object.fromEntries(includedIds.map(id => [id, Number(weights[id]) || 0]))
      return weightedShares(total, w)
    }
    if (mode === 'exact') return Object.fromEntries(includedIds.map(id => [id, round2(exact[id])]))
    if (mode === 'percent') {
      const w = Object.fromEntries(includedIds.map(id => [id, Number(percent[id]) || 0]))
      return weightedShares(total, w)
    }
    return {}
  }, [mode, includedIds.join(','), total, weights, exact, percent])

  const assigned = Object.values(preview).reduce((sum, value) => sum + Number(value || 0), 0)
  const remaining = round2(total - assigned)
  const percentSum = includedIds.reduce((sum, id) => sum + (Number(percent[id]) || 0), 0)

  const valid = includedIds.length > 0 && (
    mode === 'equal' ? true :
    mode === 'shares' ? includedIds.some(id => Number(weights[id]) > 0) :
    mode === 'exact' ? Math.abs(remaining) < SETTLE_EPSILON :
    mode === 'percent' ? Math.abs(percentSum - 100) < 0.1 : false)

  const toggle = id => setIncluded(current => ({ ...current, [id]: !current[id] }))
  const onlyMe = () => setIncluded(Object.fromEntries(ids.map(id => [id, id === paidBy])))
  const allIn = () => setIncluded(Object.fromEntries(ids.map(id => [id, true])))

  const save = () => {
    const amounts = mode === 'exact'
      ? Object.fromEntries(includedIds.map(id => [id, round2(exact[id])]))
      : preview
    const split = { mode, members:includedIds, amounts }
    if (mode === 'shares') split.weights = Object.fromEntries(includedIds.map(id => [id, Number(weights[id]) || 0]))
    if (mode === 'percent') split.weights = Object.fromEntries(includedIds.map(id => [id, Number(percent[id]) || 0]))
    onSave({ paidBy, split })
  }

  return (
    <div className="split-editor" onClick={onCancel}>
      <div className="split-sheet" onClick={event => event.stopPropagation()}>
        <div className="composer-heading">
          <div><span>DIVIDIR GASTO</span><h4>{fmt(total)} {currency}</h4></div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cerrar">✕</button>
        </div>

        <label className="split-payer">Pagó
          <select value={paidBy} onChange={event => setPaidBy(event.target.value)}>
            {members.map(member => <option key={member.userId} value={member.userId}>{label(member)}</option>)}
          </select>
        </label>

        <div className="split-methods">
          {METHODS.map(method => (
            <button type="button" key={method.key} className={mode === method.key ? 'active' : ''} onClick={() => setMode(method.key)}>{method.label}</button>
          ))}
        </div>

        <div className="split-quick">
          <button type="button" onClick={allIn}>Todos</button>
          <button type="button" onClick={onlyMe}>Solo quien pagó</button>
        </div>

        <div className="split-members">
          {members.map(member => {
            const on = included[member.userId]
            return (
              <div className={`split-row ${on ? '' : 'off'}`} key={member.userId}>
                <label className="split-check">
                  <input type="checkbox" checked={on} onChange={() => toggle(member.userId)} />
                  <span>{label(member)}</span>
                </label>
                {on && mode === 'shares' && (
                  <input className="split-input" inputMode="numeric" value={weights[member.userId]} onChange={e => setWeights({ ...weights, [member.userId]:e.target.value })} aria-label={`Partes de ${label(member)}`} />
                )}
                {on && mode === 'exact' && (
                  <input className="split-input" inputMode="decimal" placeholder="0" value={exact[member.userId]} onChange={e => setExact({ ...exact, [member.userId]:e.target.value })} aria-label={`Monto de ${label(member)}`} />
                )}
                {on && mode === 'percent' && (
                  <input className="split-input" inputMode="decimal" placeholder="0%" value={percent[member.userId]} onChange={e => setPercent({ ...percent, [member.userId]:e.target.value })} aria-label={`Porcentaje de ${label(member)}`} />
                )}
                {on && <b className="split-amount">{fmt(preview[member.userId])} {currency}</b>}
              </div>
            )
          })}
        </div>

        <div className="split-footer">
          <span className={Math.abs(remaining) < SETTLE_EPSILON ? 'ok' : 'warn'}>
            {mode === 'percent' ? `Suma ${fmt(percentSum)}%` : `Restante ${fmt(remaining)} ${currency}`}
          </span>
          <button type="button" className="primary-btn compact" disabled={!valid} onClick={save}>Guardar división</button>
        </div>
      </div>
    </div>
  )
}
