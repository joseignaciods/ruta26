import { createClient } from 'npm:@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
  const authHeader = request.headers.get('Authorization') || ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global:{ headers:{ Authorization:authHeader } } }
  )
  const { data:{ user } } = await userClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status:401, headers:cors })

  const { tripId, email } = await request.json()
  const { data:owner } = await userClient.from('trip_members').select('id').eq('trip_id',tripId).eq('user_id',user.id).eq('role','owner').maybeSingle()
  if (!owner) return new Response('Forbidden', { status:403, headers:cors })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = crypto.randomUUID() + crypto.randomUUID()
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const tokenHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const { data:invite, error } = await admin.from('trip_invitations').upsert({
    trip_id:tripId, email:email.toLowerCase(), invited_by:user.id, role:'editor',
    status:'pending', token_hash:tokenHash, share_token:token,
    expires_at:new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  }, { onConflict:'trip_id,email' }).select('*').single()
  if (error) return Response.json({ error:error.message }, { status:400, headers:cors })

  // Connect Resend or another transactional email provider here.
  return Response.json({ ok:true, token, invite }, { headers:cors })
  } catch (error) {
    return Response.json(
      { error:error instanceof Error ? error.message : 'Unexpected error' },
      { status:500, headers:cors }
    )
  }
})
