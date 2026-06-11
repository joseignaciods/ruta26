create table if not exists public.api_usage (
  month text primary key,
  tripadvisor_details_calls int not null default 0,
  tripadvisor_search_calls int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.api_usage enable row level security;

create or replace function public.increment_tripadvisor_details(p_month text, p_count int default 1)
returns int
language sql
security definer
set search_path = public
as $$
  insert into public.api_usage (month, tripadvisor_details_calls)
  values (p_month, p_count)
  on conflict (month)
  do update set
    tripadvisor_details_calls = public.api_usage.tripadvisor_details_calls + p_count,
    updated_at = now()
  returning tripadvisor_details_calls;
$$;

revoke all on function public.increment_tripadvisor_details(text, int) from public;
grant execute on function public.increment_tripadvisor_details(text, int) to service_role;
