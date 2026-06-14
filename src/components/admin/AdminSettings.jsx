import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useToast } from '../../state/ToastContext.jsx'

export default function AdminSettings() {
  const toast = useToast()
  const [form, setForm] = useState(null)
  const load = async () => {
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', true).single()
    if (error) throw error
    setForm(data)
  }
  useEffect(() => { load().catch(error => toast(error.message)) }, [toast])
  if (!form) return <div className="panel-card">Cargando...</div>
  const save = async event => {
    event.preventDefault()
    const { data, error } = await supabase.functions.invoke('admin-actions', { body:{
      action:'update_settings',
      aiDefault:Number(form.ai_monthly_limit_default),
      taDefault:Number(form.ta_monthly_limit_default),
      taGlobalCap:Number(form.ta_global_monthly_cap),
      aiEnabled:form.ai_enabled,
      taEnabled:form.ta_enabled
    } })
    if (error) {
      const payload = await error.context?.json?.().catch(() => null)
      return toast(payload?.error || error.message)
    }
    if (data?.error) return toast(data.error)
    toast('Ajustes guardados', 'success')
    await load()
  }
  return (
    <form className="panel-card admin-panel" onSubmit={save}>
      <div className="section-heading"><div><h2>Ajustes</h2><p>Límites globales y valores por defecto</p></div></div>
      {!form.ai_enabled && <div className="notice">IA desactivada globalmente.</div>}
      {!form.ta_enabled && <div className="notice">Búsquedas desactivadas globalmente.</div>}
      <div className="two-cols admin-limit-grid">
        <label>IA por usuario<input type="number" min="0" value={form.ai_monthly_limit_default} onChange={event => setForm({ ...form, ai_monthly_limit_default:event.target.value })} /></label>
        <label>Búsquedas por usuario<input type="number" min="0" value={form.ta_monthly_limit_default} onChange={event => setForm({ ...form, ta_monthly_limit_default:event.target.value })} /></label>
      </div>
      <label>Tope global Tripadvisor<input type="number" min="0" value={form.ta_global_monthly_cap} onChange={event => setForm({ ...form, ta_global_monthly_cap:event.target.value })} /></label>
      <div className="admin-switch-list">
        <label className="admin-switch">
          <span><b>Asistente IA</b><small>Permite nuevas consultas al asistente para todos los usuarios.</small></span>
          <input type="checkbox" checked={form.ai_enabled} onChange={event => setForm({ ...form, ai_enabled:event.target.checked })} />
          <i aria-hidden="true" />
        </label>
        <label className="admin-switch">
          <span><b>Búsquedas de lugares</b><small>Permite consultas externas a Tripadvisor para todos los usuarios.</small></span>
          <input type="checkbox" checked={form.ta_enabled} onChange={event => setForm({ ...form, ta_enabled:event.target.checked })} />
          <i aria-hidden="true" />
        </label>
      </div>
      <button className="primary-btn compact">Guardar ajustes</button>
    </form>
  )
}
