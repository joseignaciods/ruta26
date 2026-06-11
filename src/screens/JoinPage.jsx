import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { hasSupabase, supabase } from '../lib/supabase.js'
import { useAuth } from '../state/AuthContext.jsx'

export default function JoinPage() {
  const { token } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const accepting = useRef(false)

  useEffect(() => {
    if (!user || !hasSupabase || accepting.current) return
    accepting.current = true
    supabase.functions.invoke('accept-invite', { body:{ token } }).then(({ data, error:invokeError }) => {
      if (invokeError || data?.error) {
        accepting.current = false
        setError(invokeError?.message || data.error)
      }
      else {
        localStorage.removeItem('ruta26_pending_invite')
        navigate(`/trips/${data.tripId}`, { replace:true })
      }
    })
  }, [navigate, token, user])

  if (!hasSupabase) return <Navigate to="/trips" replace />
  if (!user) {
    localStorage.setItem('ruta26_pending_invite', token)
    return <Navigate to="/login" replace />
  }
  return <div className="center-page">{error || 'Aceptando invitación...'}</div>
}
