import { useEffect, useState } from 'react'
import { hasSupabase, supabase } from './supabase.js'
import { useAuth } from '../state/AuthContext.jsx'

export function useRole() {
  const { user } = useAuth()
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(hasSupabase)
  useEffect(() => {
    let active = true
    if (!hasSupabase || !user) {
      setRole(null)
      setLoading(false)
      return
    }
    supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (active) {
          setRole(data?.role || null)
          setLoading(false)
        }
      })
    return () => { active = false }
  }, [user])
  return {
    role,
    loading,
    isAdmin:hasSupabase && (role === 'admin' || role === 'superadmin'),
    isSuperadmin:hasSupabase && role === 'superadmin'
  }
}
