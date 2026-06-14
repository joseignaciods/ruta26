alter table public.app_settings
  add column openai_monthly_budget_usd numeric(12,2) not null default 25
  check (openai_monthly_budget_usd >= 0);

alter table public.user_usage
  add column ai_input_tokens bigint not null default 0 check (ai_input_tokens >= 0),
  add column ai_cached_input_tokens bigint not null default 0 check (ai_cached_input_tokens >= 0),
  add column ai_output_tokens bigint not null default 0 check (ai_output_tokens >= 0),
  add column ai_cost_usd numeric(14,6) not null default 0 check (ai_cost_usd >= 0);

create or replace function public.record_openai_usage(
  p_user uuid,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_usd numeric
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
begin
  if p_input_tokens < 0 or p_cached_input_tokens < 0 or p_output_tokens < 0 or p_cost_usd < 0 then
    raise exception 'invalid OpenAI usage';
  end if;

  insert into public.user_usage (
    user_id, month, ai_input_tokens, ai_cached_input_tokens, ai_output_tokens, ai_cost_usd
  ) values (
    p_user, v_month, p_input_tokens, p_cached_input_tokens, p_output_tokens, p_cost_usd
  )
  on conflict (user_id, month) do update set
    ai_input_tokens = public.user_usage.ai_input_tokens + excluded.ai_input_tokens,
    ai_cached_input_tokens = public.user_usage.ai_cached_input_tokens + excluded.ai_cached_input_tokens,
    ai_output_tokens = public.user_usage.ai_output_tokens + excluded.ai_output_tokens,
    ai_cost_usd = public.user_usage.ai_cost_usd + excluded.ai_cost_usd,
    updated_at = now();
end $$;

revoke all on function public.record_openai_usage(uuid, bigint, bigint, bigint, numeric) from public;
grant execute on function public.record_openai_usage(uuid, bigint, bigint, bigint, numeric) to service_role;
