import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { hasSupabase, setRememberMe, supabase } from '../lib/supabase.js'
import { localStore } from '../lib/localStore.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hasSupabase) {
      setSession(localStore.session())
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo(() => ({
    session,
    user:session?.user || null,
    loading,
    backend:hasSupabase ? 'supabase' : 'local',
    async register(values, remember = true) {
      // Fijar la preferencia ANTES de crear la sesión: el storage se elige al escribirla.
      setRememberMe(remember)
      if (!hasSupabase) {
        const next = localStore.register(values)
        setSession(next)
        return
      }
      const { error } = await supabase.auth.signUp({
        email:values.email,
        password:values.password,
        options:{ data:{ name:values.name } }
      })
      if (error) throw error
    },
    async login(values, remember = true) {
      // Fijar la preferencia ANTES del signIn: define si la sesión va a localStorage
      // (persistente) o a sessionStorage (solo hasta cerrar la app).
      setRememberMe(remember)
      if (!hasSupabase) {
        const next = localStore.login(values)
        setSession(next)
        return
      }
      const { error } = await supabase.auth.signInWithPassword(values)
      if (error) throw error
    },
    async magicLink(email) {
      if (!hasSupabase) throw new Error('Disponible solo con Supabase')
      const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo:`${location.origin}/trips` } })
      if (error) throw error
    },
    async resetPassword(email) {
      if (!hasSupabase) throw new Error('Disponible solo con Supabase')
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo:`${location.origin}/login` })
      if (error) throw error
    },
    async logout() {
      if (hasSupabase) await supabase.auth.signOut()
      else localStore.logout()
      setSession(null)
    }
  }), [session, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
