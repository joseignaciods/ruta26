import { createClient } from 'npm:@supabase/supabase-js'

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const monthKey = () => new Date().toISOString().slice(0, 7)

export const tripadvisorLimit = () => {
  const raw = Number(Deno.env.get('TRIPADVISOR_MONTHLY_LIMIT'))
  return Number.isFinite(raw) && raw > 0 ? raw : 4500
}

export class QuotaExceededError extends Error {
  used: number
  limit: number
  constructor(used: number, limit: number) {
    super(`Tripadvisor monthly limit reached (${used}/${limit})`)
    this.used = used
    this.limit = limit
  }
}

export async function ensureTripadvisorQuota() {
  const client = admin()
  const month = monthKey()
  const { data } = await client
    .from('api_usage')
    .select('tripadvisor_details_calls')
    .eq('month', month)
    .maybeSingle()
  const used = data?.tripadvisor_details_calls || 0
  const limit = tripadvisorLimit()
  if (used >= limit) throw new QuotaExceededError(used, limit)
  return { used, limit }
}

export async function recordTripadvisorDetails(count = 1) {
  const client = admin()
  const month = monthKey()
  try {
    await client.rpc('increment_tripadvisor_details', { p_month: month, p_count: count })
  } catch (error) {
    console.warn('Failed to record Tripadvisor usage', error)
  }
}
