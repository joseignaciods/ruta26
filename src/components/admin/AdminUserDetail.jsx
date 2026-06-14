import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useRole } from '../../lib/useRole.js'
import { useToast } from '../../state/ToastContext.jsx'
import { formatDate } from '../../lib/planner.js'

export default function AdminUserDetail({ userId, onBack }) {
  const toast = useToast()
  const { isSuperadmin } = useRole()
  const [data, setData] = useState(null)
  const [ai, setAi] = useState('')
  const [ta, setTa] = useState('')
  const [pendingRole, setPendingRole] = useState('')
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    const results = await Promise.all([
      supabase.rpc('admin_list_users'),
      supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
      supabase.from('user_limits').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('app_settings').select('*').eq('id', true).single(),
      supabase.from('trip_members').select('trip_id,trips(id,name,start_date,end_date)').eq('user_id', userId)
    ])
    const failed = results.find(result => result.error)
    if (failed) throw failed.error
    const [identities, role, limits, settings, memberships] = results
    setData({
      user:identities.data.find(item => item.user_id === userId),
      role:role.data?.role || '',
      settings:settings.data,
      memberships:memberships.data || []
    })
    setPendingRole(role.data?.role || '')
    setAi(limits.data?.ai_monthly_limit ?? '')
    setTa(limits.data?.ta_monthly_limit ?? '')
  }, [userId])
  useEffect(() => { load().catch(error => toast(error.message)) }, [load, toast])
  const invoke = async body => {
    const { data:result, error } = await supabase.functions.invoke('admin-actions', { body })
    if (error) {
      const payload = await error.context?.json?.().catch(() => null)
      throw new Error(payload?.error || error.message)
    }
    if (result?.error) throw new Error(result.error)
    await load()
  }
  if (!data) return <div className="panel-card">Cargando...</div>
  return (
    <section className="panel-card admin-panel">
      <button className="ghost-btn" onClick={onBack}>Volver a usuarios</button>
      <div className="section-heading"><div><h2>{data.user?.email}</h2><p>{data.user?.name || 'Sin nombre'}</p></div></div>
      <div className="admin-field-group">
        <label>Rol
          <select disabled={!isSuperadmin || saving} value={pendingRole} onChange={event => setPendingRole(event.target.value)}>
          <option value="">Usuario</option><option value="admin">Admin</option><option value="superadmin">Superadmin</option>
          </select>
        </label>
        {!isSuperadmin && <small>Solo un superadmin puede cambiar roles.</small>}
        {isSuperadmin && pendingRole !== data.role && (
          <div className="admin-change-warning">
            <span>El rol cambiará de <b>{data.role || 'usuario'}</b> a <b>{pendingRole || 'usuario'}</b>.</span>
            <button className="ghost-btn" disabled={saving} onClick={async () => {
              if (!window.confirm(`¿Confirmas cambiar el rol de ${data.user?.email} a ${pendingRole || 'usuario'}?`)) return
              setSaving(true)
              try {
                await invoke({ action:'set_role', targetUserId:userId, role:pendingRole || null })
                toast('Rol actualizado', 'success')
              } catch (error) { toast(error.message) }
              finally { setSaving(false) }
            }}>{saving ? 'Guardando...' : 'Confirmar cambio de rol'}</button>
          </div>
        )}
      </div>
      <div className="two-cols admin-limit-grid">
        <label>Límite IA<input type="number" min="0" value={ai} placeholder={`Global: ${data.settings.ai_monthly_limit_default}`} onChange={event => setAi(event.target.value)} /><small>{ai === '' ? `Hereda el límite global de ${data.settings.ai_monthly_limit_default}.` : 'Límite personalizado para este usuario.'}</small></label>
        <label>Límite búsquedas<input type="number" min="0" value={ta} placeholder={`Global: ${data.settings.ta_monthly_limit_default}`} onChange={event => setTa(event.target.value)} /><small>{ta === '' ? `Hereda el límite global de ${data.settings.ta_monthly_limit_default}.` : 'Límite personalizado para este usuario.'}</small></label>
      </div>
      <button className="primary-btn compact" onClick={async () => {
        try {
          await invoke({ action:'set_limits', targetUserId:userId, ai:ai === '' ? null : Number(ai), ta:ta === '' ? null : Number(ta) })
          toast('Límites actualizados', 'success')
        } catch (error) { toast(error.message) }
      }}>Guardar límites</button>
      <h3>Viajes</h3>
      {!data.memberships.length ? <p>Sin viajes.</p> : data.memberships.map(member => (
        <div className="member-line admin-trip-row" key={member.trip_id}><span>{member.trips?.name || member.trip_id}<small>{formatDate(member.trips?.start_date) || 'Sin fecha'}</small></span></div>
      ))}
    </section>
  )
}
