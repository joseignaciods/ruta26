// Balances y división de gastos. El gasto guarda su división en `split`
// (embebida), y `split.amounts` es la fuente de verdad ya resuelta. Si un gasto
// no trae split (datos viejos), se reparte igualitario entre los miembros
// activos en runtime — idéntico al comportamiento histórico.

// Tolerancia compartida por editor, balances y settle-up (ver settle.js).
export const SETTLE_EPSILON = 0.01

const round2 = value => Math.round(Number(value || 0) * 100) / 100

// Reparte un monto en centavos de forma determinista: el remanente cae en los
// primeros miembros, garantizando que la suma sea exactamente `amount`.
export const equalShares = (amount, memberIds) => {
  const out = {}
  const count = memberIds.length
  if (!count) return out
  const cents = Math.round(Number(amount || 0) * 100)
  const base = Math.floor(cents / count)
  const remainder = cents - base * count
  memberIds.forEach((id, index) => {
    out[id] = (base + (index < remainder ? 1 : 0)) / 100
  })
  return out
}

// Reparte por pesos (partes) o porcentajes, ajustando el último para cuadrar.
export const weightedShares = (amount, weights) => {
  const ids = Object.keys(weights).filter(id => Number(weights[id]) > 0)
  const out = {}
  if (!ids.length) return out
  const totalWeight = ids.reduce((sum, id) => sum + Number(weights[id]), 0)
  const cents = Math.round(Number(amount || 0) * 100)
  let assigned = 0
  ids.forEach((id, index) => {
    if (index === ids.length - 1) {
      out[id] = (cents - assigned) / 100
    } else {
      const share = Math.round(cents * Number(weights[id]) / totalWeight)
      assigned += share
      out[id] = share / 100
    }
  })
  return out
}

// Devuelve los montos por participante de un gasto, resolviendo el fallback
// igualitario cuando no hay split explícito.
export const sharesForExpense = (expense, activeMemberIds) => {
  const split = expense.split
  if (split && split.amounts && Object.keys(split.amounts).length) return split.amounts
  const members = split && split.members && split.members.length ? split.members : activeMemberIds
  return equalShares(expense.amount, members)
}

// Recalcula los montos de un split con el monto final del gasto (por si cambió
// después de abrir el editor). El modo 'exact' conserva los montos absolutos.
export const resolveSplit = (split, amount, activeMemberIds) => {
  if (!split || !split.mode) return {}
  const members = split.members && split.members.length ? split.members : activeMemberIds
  if (split.mode === 'exact') return { mode:'exact', members, amounts:split.amounts || {} }
  if (split.mode === 'equal') return { mode:'equal', members, amounts:equalShares(amount, members) }
  const weights = split.weights || Object.fromEntries(members.map(id => [id, 1]))
  return { mode:split.mode, members, weights, amounts:weightedShares(amount, weights) }
}

// Balances por moneda. `net[userId]` = lo pagado − lo que le toca.
// Positivo: le deben. Negativo: debe.
export function computeBalances(expenses, members, currency) {
  const activeIds = members.filter(member => member.status === 'active').map(member => member.userId)
  const net = {}
  activeIds.forEach(id => { net[id] = 0 })
  let total = 0
  for (const expense of expenses) {
    if (expense.currency !== currency) continue
    const amount = Number(expense.amount || 0)
    if (!expense.isSettlement) total += amount
    if (expense.paidBy != null) net[expense.paidBy] = (net[expense.paidBy] || 0) + amount
    const shares = sharesForExpense(expense, activeIds)
    for (const [id, share] of Object.entries(shares)) {
      net[id] = (net[id] || 0) - Number(share || 0)
    }
  }
  for (const id of Object.keys(net)) net[id] = round2(net[id])
  return { net, total: round2(total), activeIds }
}

// Lista de monedas presentes en los gastos (para iterar balances por moneda).
export const expenseCurrencies = expenses =>
  [...new Set(expenses.map(expense => expense.currency).filter(Boolean))]
