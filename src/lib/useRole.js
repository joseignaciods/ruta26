import { useEffect, useState } from 'react'
import { hasSupabase, supabase } from './supabase.js'
import { useAuth } from '../state/AuthContext.jsx'

export function useRole() {
  const { user } = useAuth()
  const [role, setRole] = useState(null)
  const [resolvedUserId, setResolvedUserId] = useState(null)
  useEffect(() => {
    let active = true
    if (!hasSupabase || !user) {
      setRole(null)
      setResolvedUserId(null)
      return
    }
    supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (active) {
          setRole(error ? null : data?.role || null)
          setResolvedUserId(user.id)
        }
      })
    return () => { active = false }
  }, [user])
  const loading = hasSupabase && Boolean(user) && resolvedUserId !== user.id
  return {
    role,
    loading,
    isAdmin:hasSupabase && (role === 'admin' || role === 'superadmin'),
    isSuperadmin:hasSupabase && role === 'superadmin'
  }
}
