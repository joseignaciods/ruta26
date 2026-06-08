import OpenAI from 'npm:openai'
import { createClient } from 'npm:@supabase/supabase-js'

Deno.serve(async request => {
  const authHeader = request.headers.get('Authorization') || ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global:{ headers:{ Authorization:authHeader } } }
  )
  const { data:{ user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status:401 })

  const { tripId, prompt } = await request.json()
  const { data:trip } = await supabase.from('trips').select('id,name,days(*,activities(*))').eq('id',tripId).single()
  if (!trip) return new Response('Forbidden', { status:403 })

  const openai = new OpenAI({ apiKey:Deno.env.get('OPENAI_API_KEY') })
  const response = await openai.responses.create({
    model:'gpt-5-mini',
    input:`Viaje: ${JSON.stringify(trip)}\n\nPregunta del usuario: ${prompt}`
  })
  return Response.json({ text:response.output_text })
})
