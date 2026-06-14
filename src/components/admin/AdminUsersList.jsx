import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../state/ToastContext.jsx'
import Skeleton from '../Skeleton.jsx'

export default function AdminUsersList({ onSelect }) {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    const load = async () => {
      const month = new Date().toISOString().slice(0, 7)
      const results = await Promise.all([
        supabase.rpc('admin_list_users'),
        supabase.from('user_roles').select('user_id,role'),
        supabase.from('user_limits').select('user_id,ai_monthly_limit,ta_monthly_limit'),
        supabase.from('user_usage').select('user_id,ai_calls,ta_details_calls').eq('month', month),
        supabase.from('app_settings').select('*').eq('id', true).single(),
        supabase.from('trip_members').select('user_id,trip_id').eq('status', 'active')
      ])
      const failed = results.find(result => result.error)
      if (failed) throw failed.error
      const [identities, roles, limits, usage, settings, memberships] = results
      const byId = rows => new Map((rows || []).map(row => [row.user_id, row]))
      const roleMap = byId(roles.data)
      const limitMap = byId(limits.data)
      const usageMap = byId(usage.data)
      const tripCounts = new Map()
      for (const member of memberships.data || []) tripCounts.set(member.user_id, (tripCounts.get(member.user_id) || 0) + 1)
      return (identities.data || []).map(user => {
        const limit = limitMap.get(user.user_id) || {}
        const used = usageMap.get(user.user_id) || {}
        return {
          ...user,
          role:roleMap.get(user.user_id)?.role || null,
          aiUsed:used.ai_calls || 0,
          taUsed:used.ta_details_calls || 0,
          aiLimit:limit.ai_monthly_limit ?? settings.data.ai_monthly_limit_default,
          taLimit:limit.ta_monthly_limit ?? settings.data.ta_monthly_limit_default,
          tripCount:tripCounts.get(user.user_id) || 0
        }
      })
    }
    load().then(rows => { if (active) setUsers(rows) })
      .catch(error => toast(error.message))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [toast])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? users.filter(user => `${user.email} ${user.name}`.toLowerCase().includes(needle)) : users
  }, [query, users])
  if (loading) return <Skeleton variant="trip" />
  return (
    <section className="panel-card admin-panel">
      <div className="section-heading"><div><h2>Usuarios</h2><p>{users.length} cuentas registradas</p></div></div>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por email o nombre" />
      {!visible.length ? <div className="empty-panel"><h2>No hay usuarios</h2></div> : visible.map(user => (
        <button className="member-line admin-user-row" key={user.user_id} onClick={() => onSelect(user.user_id)}>
          <span><strong>{user.email}</strong><small>{user.name || 'Sin nombre'} · {user.tripCount} viaje(s)</small></span>
          <span className="admin-usage"><small>IA: {user.aiUsed}/{user.aiLimit}</small><small>Búsquedas: {user.taUsed}/{user.taLimit}</small></span>
          <b>{user.role || 'usuario'}</b>
        </button>
      ))}
    </section>
  )
}
