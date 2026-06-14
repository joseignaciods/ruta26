import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../state/ToastContext.jsx'
import Skeleton from '../Skeleton.jsx'
import UsageMeter from './UsageMeter.jsx'

const usd = value => `$${Number(value || 0).toFixed(Number(value || 0) < 0.01 ? 4 : 2)}`
const tokens = value => new Intl.NumberFormat('es-CL').format(Number(value || 0))

export default function AdminUsersList({ onSelect }) {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let active = true
    const load = async () => {
      const month = new Date().toISOString().slice(0, 7)
      const results = await Promise.all([
        supabase.rpc('admin_list_users'),
        supabase.from('user_roles').select('user_id,role'),
        supabase.from('user_limits').select('user_id,ai_monthly_limit,ta_monthly_limit'),
        supabase.from('user_usage').select('user_id,ai_calls,ta_details_calls,ai_input_tokens,ai_cached_input_tokens,ai_output_tokens,ai_cost_usd').eq('month', month),
        supabase.from('app_settings').select('*').eq('id', true).single(),
        supabase.from('trip_members').select('user_id,trip_id').eq('status', 'active'),
        supabase.from('api_usage').select('tripadvisor_details_calls').eq('month', month).maybeSingle()
      ])
      const failed = results.find(result => result.error)
      if (failed) throw failed.error
      const [identities, roles, limits, usage, settings, memberships, globalUsage] = results
      const byId = rows => new Map((rows || []).map(row => [row.user_id, row]))
      const roleMap = byId(roles.data)
      const limitMap = byId(limits.data)
      const usageMap = byId(usage.data)
      const tripCounts = new Map()
      for (const member of memberships.data || []) tripCounts.set(member.user_id, (tripCounts.get(member.user_id) || 0) + 1)
      const rows = (identities.data || []).map(user => {
        const limit = limitMap.get(user.user_id) || {}
        const used = usageMap.get(user.user_id) || {}
        return {
          ...user,
          role:roleMap.get(user.user_id)?.role || null,
          aiUsed:used.ai_calls || 0,
          taUsed:used.ta_details_calls || 0,
          aiInputTokens:used.ai_input_tokens || 0,
          aiCachedTokens:used.ai_cached_input_tokens || 0,
          aiOutputTokens:used.ai_output_tokens || 0,
          aiCostUsd:Number(used.ai_cost_usd || 0),
          aiLimit:limit.ai_monthly_limit ?? settings.data.ai_monthly_limit_default,
          taLimit:limit.ta_monthly_limit ?? settings.data.ta_monthly_limit_default,
          tripCount:tripCounts.get(user.user_id) || 0
        }
      })
      return {
        rows,
        summary:{
          openaiCost:rows.reduce((sum, user) => sum + user.aiCostUsd, 0),
          inputTokens:rows.reduce((sum, user) => sum + Number(user.aiInputTokens), 0),
          cachedTokens:rows.reduce((sum, user) => sum + Number(user.aiCachedTokens), 0),
          outputTokens:rows.reduce((sum, user) => sum + Number(user.aiOutputTokens), 0),
          openaiBudget:Number(settings.data.openai_monthly_budget_usd || 0),
          taUsed:Number(globalUsage.data?.tripadvisor_details_calls || 0),
          taLimit:Number(settings.data.ta_global_monthly_cap || 0)
        }
      }
    }
    load().then(result => {
      if (!active) return
      setUsers(result.rows)
      setSummary(result.summary)
    })
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
      {summary && (
        <div className="admin-usage-overview">
          <UsageMeter
            label="Gasto OpenAI este mes"
            value={summary.openaiCost}
            max={summary.openaiBudget}
            format={usd}
            detail={`${tokens(summary.inputTokens)} entrada · ${tokens(summary.cachedTokens)} caché · ${tokens(summary.outputTokens)} salida`}
          />
          <UsageMeter
            label="Requests Tripadvisor este mes"
            value={summary.taUsed}
            max={summary.taLimit}
            format={tokens}
            detail="Solicitudes de detalle facturables contra el techo global."
            tone="pink"
          />
        </div>
      )}
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por email o nombre" />
      {!visible.length ? <div className="empty-panel"><h2>No hay usuarios</h2></div> : visible.map(user => (
        <button className="member-line admin-user-row" key={user.user_id} onClick={() => onSelect(user.user_id)}>
          <span><strong>{user.email}</strong><small>{user.name || 'Sin nombre'} · {user.tripCount} viaje(s)</small></span>
          <span className="admin-usage">
            <small>OpenAI: {usd(user.aiCostUsd)} · {tokens(Number(user.aiInputTokens) + Number(user.aiOutputTokens))} tokens</small>
            <small>IA: {user.aiUsed}/{user.aiLimit} · Tripadvisor: {user.taUsed}/{user.taLimit}</small>
          </span>
          <b>{user.role || 'usuario'}</b>
        </button>
      ))}
    </section>
  )
}
