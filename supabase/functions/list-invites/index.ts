import { createClient } from 'npm:@supabase/supabase-js'

const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers:{ ...cors, 'Content-Type':'application/json' } })

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
    if (!user?.email) return json({ error:'Unauthorized' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await admin
      .from('trip_invitations')
      .select('id,email,role,expires_at,created_at,trips(id,name)')
      .eq('email', user.email.toLowerCase())
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending:false })
    if (error) return json({ error:error.message }, 400)
    return json({ invitations:data || [] })
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
