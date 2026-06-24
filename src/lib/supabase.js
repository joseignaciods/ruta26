import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const hasSupabase = Boolean(url && key)

// "Mantenerme conectado": cuando está activo, la sesión vive en localStorage y
// sobrevive a cerrar la app; cuando no, vive en sessionStorage y se borra al
// cerrar (útil en dispositivos compartidos). La preferencia se guarda en
// localStorage para elegir el storage correcto al restaurar la sesión al arrancar.
const REMEMBER_KEY = 'ruta26.keepSignedIn'

const safe = factory => { try { return factory() } catch { return null } }
const localStorageObj = () => safe(() => window.localStorage)
const sessionStorageObj = () => safe(() => window.sessionStorage)

// Por defecto recordamos (la mayoría quiere no re-loguear). Solo es false si el
// usuario lo desmarcó explícitamente alguna vez.
export const getRememberMe = () => {
  try { return localStorageObj()?.getItem(REMEMBER_KEY) !== '0' } catch { return true }
}
export const setRememberMe = value => {
  try { localStorageObj()?.setItem(REMEMBER_KEY, value ? '1' : '0') } catch { /* sin storage disponible */ }
}

// Adaptador de storage para supabase-auth: enruta a localStorage o sessionStorage
// según la preferencia vigente y mantiene una sola copia de la sesión (al escribir
// limpia el otro storage). Conserva la storageKey por defecto para no desloguear a
// quienes ya tienen sesión guardada.
const authStorage = {
  getItem: keyName => {
    try {
      // Solo uno de los dos tiene el valor (setItem limpia el otro); leemos de donde esté.
      return localStorageObj()?.getItem(keyName) ?? sessionStorageObj()?.getItem(keyName) ?? null
    } catch { return null }
  },
  setItem: (keyName, value) => {
    try {
      const persistent = getRememberMe()
      const primary = persistent ? localStorageObj() : sessionStorageObj()
      const secondary = persistent ? sessionStorageObj() : localStorageObj()
      primary?.setItem(keyName, value)
      secondary?.removeItem(keyName)
    } catch { /* sin storage disponible */ }
  },
  removeItem: keyName => {
    try { localStorageObj()?.removeItem(keyName); sessionStorageObj()?.removeItem(keyName) } catch { /* sin storage disponible */ }
  }
}

export const supabase = hasSupabase
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: authStorage
      }
    })
  : null
