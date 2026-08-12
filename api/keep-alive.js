// Keep-alive de Supabase: lo invoca el cron de Vercel (ver vercel.json) una vez
// al día. Le pega una consulta trivial a la API REST del proyecto para que el
// plan free nunca lo detecte como inactivo y lo pause (el pausado tumba la API y
// rompe el login). Cualquier respuesta HTTP de Supabase ya cuenta como actividad.
export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL || 'https://zzjxdymptopmaxxlfhif.supabase.co'
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
  const started = Date.now()
  try {
    const response = await fetch(`${url}/rest/v1/trips?select=id&limit=1`, {
      headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : {}
    })
    return res.status(200).json({
      ok: true,
      supabaseStatus: response.status,
      ms: Date.now() - started,
      at: new Date().toISOString()
    })
  } catch (error) {
    return res.status(502).json({ ok: false, error: String(error), at: new Date().toISOString() })
  }
}
