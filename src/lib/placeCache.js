// Caché ligera de búsquedas de lugares. Cada búsqueda en Tripadvisor consume
// cuota mensual (hasta 8 llamadas de detalle), así que reutilizamos resultados
// recientes en vez de repetir la misma consulta.
const PREFIX = 'ruta26_places_'
const TTL_MS = 12 * 60 * 60 * 1000
const MAX_ENTRIES = 40

export const placeCacheKey = parts =>
  PREFIX + parts.map(part => String(part ?? '').trim().toLowerCase()).join('|')

export function readPlaceCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (!entry?.at || Date.now() - entry.at > TTL_MS) {
      localStorage.removeItem(key)
      return null
    }
    return entry.value
  } catch {
    return null
  }
}

export function writePlaceCache(key, value) {
  try {
    const keys = Object.keys(localStorage).filter(item => item.startsWith(PREFIX))
    if (keys.length >= MAX_ENTRIES) {
      const dated = keys.map(item => {
        try { return { item, at:JSON.parse(localStorage.getItem(item))?.at || 0 } } catch { return { item, at:0 } }
      }).sort((a, b) => a.at - b.at)
      for (const { item } of dated.slice(0, keys.length - MAX_ENTRIES + 1)) localStorage.removeItem(item)
    }
    localStorage.setItem(key, JSON.stringify({ at:Date.now(), value }))
  } catch { /* almacenamiento lleno: seguimos sin caché */ }
}
