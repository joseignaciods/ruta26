import { createClient } from 'npm:@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{ ...cors, 'Content-Type':'application/json' } })
const hash = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:cors })
  try {
    const authHeader = request.headers.get('Authorization') || ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global:{ headers:{ Authorization:authHeader } } })
    const { data:{ user } } = await userClient.auth.getUser()
    if (!user?.email) return json({ error:'Unauthorized' }, 401)
    const { token, invitationId, reject = false } = await request.json()
    if (!token && !invitationId) return json({ error:'Invitación requerida' }, 400)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    let query = admin.from('trip_invitations').select('*').eq('status', 'pending').gt('expires_at', new Date().toISOString())
    if (token) query = query.eq('token_hash', await hash(token))
    else query = query.eq('id', invitationId)
    const { data:invite } = await query.maybeSingle()
    if (!invite) return json({ error:'Invitación inválida o vencida' }, 404)
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) return json({ error:'Esta invitación pertenece a otro correo' }, 403)
    if (reject) {
      await admin.from('trip_invitations').update({ status:'rejected' }).eq('id', invite.id)
      return json({ ok:true, rejected:true })
    }
    const { error } = await admin.from('trip_members').upsert({
      trip_id:invite.trip_id, user_id:user.id, role:invite.role, status:'active'
    }, { onConflict:'trip_id,user_id' })
    if (error) return json({ error:error.message }, 400)
    await admin.from('trip_invitations').update({ status:'accepted' }).eq('id', invite.id)
    return json({ ok:true, tripId:invite.trip_id })
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
