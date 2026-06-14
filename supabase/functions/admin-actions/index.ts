import { createClient } from 'npm:@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers:{ ...cors, 'Content-Type':'application/json' } })

const intOrNull = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : undefined
}
const reqInt = (value: unknown): number | undefined => {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : undefined
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:cors })
  try {
    const authHeader = request.headers.get('Authorization') || ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global:{ headers:{ Authorization:authHeader } } }
    )
    const { data:{ user } } = await userClient.auth.getUser()
    if (!user) return json({ error:'Unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data:roleRow, error:roleError } = await admin
      .from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleError) throw roleError
    const isAdmin = roleRow?.role === 'admin' || roleRow?.role === 'superadmin'
    const isSuperadmin = roleRow?.role === 'superadmin'
    if (!isAdmin) return json({ error:'Forbidden' }, 403)

    const { action, targetUserId, ...payload } = await request.json()
    const log = async (detail: unknown, targetTrip?: string) => {
      const { error } = await admin.from('admin_audit_log').insert({
        actor:user.id,
        action,
        target_user:targetUserId || null,
        target_trip:targetTrip || null,
        detail
      })
      if (error) throw error
    }

    if (action === 'set_role') {
      if (!isSuperadmin) return json({ error:'Solo superadmin puede cambiar roles' }, 403)
      if (!targetUserId) return json({ error:'targetUserId requerido' }, 400)
      const role = payload.role
      if (role !== null && role !== 'admin' && role !== 'superadmin') {
        return json({ error:'Rol inválido' }, 400)
      }
      const { error } = await admin.rpc('admin_set_role', {
        p_actor:user.id, p_target:targetUserId, p_role:role
      })
      if (error) {
        if (error.message.includes('self lockout')) return json({ error:'No puedes quitarte tu propio rol de superadmin.' }, 400)
        if (error.message.includes('last superadmin')) return json({ error:'No puedes eliminar al último superadmin.' }, 400)
        throw error
      }
      await log({ role })
      return json({ ok:true })
    }

    if (action === 'set_limits') {
      if (!targetUserId) return json({ error:'targetUserId requerido' }, 400)
      const ai = intOrNull(payload.ai)
      const ta = intOrNull(payload.ta)
      if (ai === undefined || ta === undefined) return json({ error:'Límites inválidos (enteros >= 0 o null)' }, 400)
      const { error } = await admin.from('user_limits').upsert({
        user_id:targetUserId,
        ai_monthly_limit:ai,
        ta_monthly_limit:ta,
        updated_at:new Date().toISOString()
      }, { onConflict:'user_id' })
      if (error) throw error
      await log({ ai, ta })
      return json({ ok:true })
    }

    if (action === 'update_settings') {
      const patch: Record<string, unknown> = { updated_at:new Date().toISOString() }
      const integerFields = [
        ['aiDefault', 'ai_monthly_limit_default'],
        ['taDefault', 'ta_monthly_limit_default'],
        ['taGlobalCap', 'ta_global_monthly_cap']
      ] as const
      for (const [source, column] of integerFields) {
        if (payload[source] === undefined) continue
        const value = reqInt(payload[source])
        if (value === undefined) return json({ error:`Valor inválido para ${source}` }, 400)
        patch[column] = value
      }
      for (const [source, column] of [['aiEnabled', 'ai_enabled'], ['taEnabled', 'ta_enabled']] as const) {
        if (payload[source] === undefined) continue
        if (typeof payload[source] !== 'boolean') return json({ error:`Valor inválido para ${source}` }, 400)
        patch[column] = payload[source]
      }
      if (Object.keys(patch).length === 1) return json({ error:'Sin cambios válidos' }, 400)
      const { error } = await admin.from('app_settings').update(patch).eq('id', true)
      if (error) throw error
      await log(patch)
      return json({ ok:true })
    }

    if (action === 'delete_trip') {
      if (!payload.tripId) return json({ error:'tripId requerido' }, 400)
      const { error } = await admin.from('trips').delete().eq('id', payload.tripId)
      if (error) throw error
      await log({}, payload.tripId)
      return json({ ok:true })
    }
    return json({ error:'Acción desconocida' }, 400)
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
