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

export async function loadSettings() {
  const { data, error } = await admin()
    .from('app_settings')
    .select('ai_enabled, ta_enabled, ta_global_monthly_cap')
    .eq('id', true)
    .maybeSingle()
  if (error) console.warn('Failed to load app settings, using defaults', error.message)
  return {
    aiEnabled:data?.ai_enabled ?? true,
    taEnabled:data?.ta_enabled ?? true,
    taGlobalCap:Number(data?.ta_global_monthly_cap) || tripadvisorLimit()
  }
}

export class UserQuotaExceededError extends Error {
  kind: 'ai' | 'ta'
  used: number
  limit: number
  constructor(kind: 'ai' | 'ta', used: number, limit: number) {
    super(`Per-user ${kind} monthly limit reached (${used}/${limit})`)
    this.kind = kind
    this.used = used
    this.limit = limit
  }
}

export async function ensureAndConsumeUserQuota(userId: string, kind: 'ai' | 'ta', count = 1) {
  const { data, error } = await admin()
    .rpc('consume_user_quota', { p_user:userId, p_kind:kind, p_count:count })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.allowed) throw new UserQuotaExceededError(kind, row?.used ?? 0, row?.lim ?? 0)
  return { used:Number(row.used), limit:Number(row.lim) }
}

export async function ensureAndConsumeTripadvisorQuota(userId: string, count = 1) {
  const { data, error } = await admin()
    .rpc('consume_tripadvisor_quotas', { p_user:userId, p_count:count })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.allowed) {
    if (row?.reason === 'user') {
      throw new UserQuotaExceededError('ta', Number(row.user_used || 0), Number(row.user_limit || 0))
    }
    throw new QuotaExceededError(Number(row?.global_used || 0), Number(row?.global_limit || 0))
  }
  return {
    used:Number(row.user_used),
    limit:Number(row.user_limit),
    globalUsed:Number(row.global_used),
    globalLimit:Number(row.global_limit)
  }
}
