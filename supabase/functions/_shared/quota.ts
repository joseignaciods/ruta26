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

type OpenAIUsage = {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
}

const modelPricing = (model: string) => {
  const configured = {
    input:Number(Deno.env.get('OPENAI_INPUT_USD_PER_MILLION')),
    cached:Number(Deno.env.get('OPENAI_CACHED_INPUT_USD_PER_MILLION')),
    output:Number(Deno.env.get('OPENAI_OUTPUT_USD_PER_MILLION'))
  }
  if (Object.values(configured).every(value => Number.isFinite(value) && value >= 0)) return configured
  if (model.startsWith('gpt-5.4-mini')) return { input:0.75, cached:0.075, output:4.5 }
  if (model.startsWith('gpt-5.4')) return { input:2.5, cached:0.25, output:15 }
  if (model.startsWith('gpt-5-mini')) return { input:0.25, cached:0.025, output:2 }
  if (model.startsWith('gpt-5')) return { input:1.25, cached:0.125, output:10 }
  return { input:0.75, cached:0.075, output:4.5 }
}

export async function recordOpenAIUsage(userId: string, model: string, usage: OpenAIUsage | null | undefined) {
  if (!usage) return
  const inputTokens = Math.max(0, Number(usage.input_tokens || 0))
  const cachedTokens = Math.min(inputTokens, Math.max(0, Number(usage.input_tokens_details?.cached_tokens || 0)))
  const outputTokens = Math.max(0, Number(usage.output_tokens || 0))
  const prices = modelPricing(model)
  const cost = (
    (inputTokens - cachedTokens) * prices.input +
    cachedTokens * prices.cached +
    outputTokens * prices.output
  ) / 1_000_000
  const { error } = await admin().rpc('record_openai_usage', {
    p_user:userId,
    p_input_tokens:inputTokens,
    p_cached_input_tokens:cachedTokens,
    p_output_tokens:outputTokens,
    p_cost_usd:cost
  })
  if (error) console.warn('Failed to record OpenAI usage', error.message)
}
