drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'superadmin')),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;

create or replace function public.is_admin(p_uid uuid default null)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = coalesce(p_uid, (select auth.uid()))
      and role in ('admin', 'superadmin')
  )
$$;

create or replace function public.is_superadmin(p_uid uuid default null)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = coalesce(p_uid, (select auth.uid()))
      and role = 'superadmin'
  )
$$;

create policy "read own role" on public.user_roles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "admins read all roles" on public.user_roles
  for select to authenticated using (public.is_admin());
create policy "superadmins manage roles" on public.user_roles
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create table public.app_settings (
  id boolean primary key default true check (id),
  ai_monthly_limit_default int not null default 200 check (ai_monthly_limit_default >= 0),
  ta_monthly_limit_default int not null default 300 check (ta_monthly_limit_default >= 0),
  ta_global_monthly_cap int not null default 4500 check (ta_global_monthly_cap >= 0),
  ai_enabled boolean not null default true,
  ta_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
create policy "settings read" on public.app_settings for select to authenticated using (true);
create policy "admins update settings" on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.user_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_monthly_limit int check (ai_monthly_limit >= 0),
  ta_monthly_limit int check (ta_monthly_limit >= 0),
  updated_at timestamptz not null default now()
);
alter table public.user_limits enable row level security;
create policy "read own or admin limits" on public.user_limits
  for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

create table public.user_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  ai_calls int not null default 0 check (ai_calls >= 0),
  ta_details_calls int not null default 0 check (ta_details_calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.user_usage enable row level security;
create policy "read own or admin usage" on public.user_usage
  for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

create or replace function public.consume_user_quota(
  p_user uuid, p_kind text, p_count int default 1
) returns table(allowed boolean, used int, lim int)
language plpgsql security definer set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_limit int;
  v_used int;
begin
  if p_kind not in ('ai', 'ta') or p_count <= 0 then
    raise exception 'invalid quota request';
  end if;

  select case when p_kind = 'ai'
      then coalesce(ul.ai_monthly_limit, s.ai_monthly_limit_default)
      else coalesce(ul.ta_monthly_limit, s.ta_monthly_limit_default)
    end
    into v_limit
    from public.app_settings s
    left join public.user_limits ul on ul.user_id = p_user
    where s.id = true;

  if v_limit is null then raise exception 'app settings missing'; end if;

  insert into public.user_usage (user_id, month)
  values (p_user, v_month) on conflict (user_id, month) do nothing;

  if p_kind = 'ai' then
    update public.user_usage
      set ai_calls = ai_calls + p_count, updated_at = now()
      where user_id = p_user and month = v_month
        and ai_calls + p_count <= v_limit
      returning ai_calls into v_used;
  else
    update public.user_usage
      set ta_details_calls = ta_details_calls + p_count, updated_at = now()
      where user_id = p_user and month = v_month
        and ta_details_calls + p_count <= v_limit
      returning ta_details_calls into v_used;
  end if;

  if v_used is null then
    select case when p_kind = 'ai' then ai_calls else ta_details_calls end
      into v_used from public.user_usage
      where user_id = p_user and month = v_month;
    return query select false, coalesce(v_used, 0), v_limit;
  end if;
  return query select true, v_used, v_limit;
end $$;
revoke all on function public.consume_user_quota(uuid, text, int) from public;
grant execute on function public.consume_user_quota(uuid, text, int) to service_role;

create or replace function public.consume_tripadvisor_quotas(
  p_user uuid, p_count int default 1
) returns table(
  allowed boolean, reason text, user_used int, user_limit int,
  global_used int, global_limit int
)
language plpgsql security definer set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_user_limit int;
  v_user_used int;
  v_global_limit int;
  v_global_used int;
begin
  if p_count <= 0 then raise exception 'invalid quota request'; end if;

  select coalesce(ul.ta_monthly_limit, s.ta_monthly_limit_default),
         s.ta_global_monthly_cap
    into v_user_limit, v_global_limit
    from public.app_settings s
    left join public.user_limits ul on ul.user_id = p_user
    where s.id = true;
  if v_user_limit is null or v_global_limit is null then
    raise exception 'app settings missing';
  end if;

  insert into public.user_usage (user_id, month)
  values (p_user, v_month) on conflict (user_id, month) do nothing;
  insert into public.api_usage (month) values (v_month)
  on conflict (month) do nothing;

  perform pg_advisory_xact_lock(hashtext('ruta26-ta-' || v_month));
  select ta_details_calls into v_user_used
    from public.user_usage where user_id = p_user and month = v_month for update;
  select tripadvisor_details_calls into v_global_used
    from public.api_usage where month = v_month for update;

  if v_global_used + p_count > v_global_limit then
    return query select false, 'global', v_user_used, v_user_limit, v_global_used, v_global_limit;
    return;
  end if;
  if v_user_used + p_count > v_user_limit then
    return query select false, 'user', v_user_used, v_user_limit, v_global_used, v_global_limit;
    return;
  end if;

  update public.user_usage
    set ta_details_calls = ta_details_calls + p_count, updated_at = now()
    where user_id = p_user and month = v_month
    returning ta_details_calls into v_user_used;
  update public.api_usage
    set tripadvisor_details_calls = tripadvisor_details_calls + p_count, updated_at = now()
    where month = v_month
    returning tripadvisor_details_calls into v_global_used;
  return query select true, null::text, v_user_used, v_user_limit, v_global_used, v_global_limit;
end $$;
revoke all on function public.consume_tripadvisor_quotas(uuid, int) from public;
grant execute on function public.consume_tripadvisor_quotas(uuid, int) to service_role;

create or replace function public.admin_set_role(
  p_actor uuid, p_target uuid, p_role text
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_current text; v_count int;
begin
  if not public.is_superadmin(p_actor) then raise exception 'forbidden'; end if;
  if p_role is not null and p_role not in ('admin', 'superadmin') then
    raise exception 'invalid role';
  end if;
  if p_actor = p_target and p_role is distinct from 'superadmin' then
    raise exception 'self lockout';
  end if;

  perform pg_advisory_xact_lock(hashtext('ruta26-superadmin-role-change'));
  select role into v_current from public.user_roles where user_id = p_target for update;
  if v_current = 'superadmin' and p_role is distinct from 'superadmin' then
    select count(*) into v_count from public.user_roles where role = 'superadmin';
    if v_count <= 1 then raise exception 'last superadmin'; end if;
  end if;

  if p_role is null then
    delete from public.user_roles where user_id = p_target;
  else
    insert into public.user_roles (user_id, role, granted_by)
    values (p_target, p_role, p_actor)
    on conflict (user_id) do update
      set role = excluded.role, granted_by = excluded.granted_by, created_at = now();
  end if;
end $$;
revoke all on function public.admin_set_role(uuid, uuid, text) from public;
grant execute on function public.admin_set_role(uuid, uuid, text) to service_role;

create or replace function public.admin_list_users()
returns table(user_id uuid, email text, name text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select u.id, u.email::text, p.name, u.created_at
    from auth.users u left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null references auth.users(id),
  action text not null,
  target_user uuid references auth.users(id),
  target_trip uuid references public.trips(id),
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
create policy "admins read audit" on public.admin_audit_log
  for select to authenticated using (public.is_admin());

create policy "admins read trips" on public.trips for select to authenticated using (public.is_admin());
create policy "admins read members" on public.trip_members for select to authenticated using (public.is_admin());
create policy "admins read invitations" on public.trip_invitations for select to authenticated using (public.is_admin());
create policy "admins read days" on public.days for select to authenticated using (public.is_admin());
create policy "admins read activities" on public.activities for select to authenticated using (public.is_admin());
create policy "admins read hotels" on public.hotels for select to authenticated using (public.is_admin());
create policy "admins read expenses" on public.expenses for select to authenticated using (public.is_admin());
create policy "admins read profiles" on public.profiles for select to authenticated using (public.is_admin());
create policy "admins read api_usage" on public.api_usage for select to authenticated using (public.is_admin());
create policy "admins delete trips" on public.trips for delete to authenticated using (public.is_admin());
create policy "admins manage membership" on public.trip_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.user_roles (user_id, role)
select id, 'superadmin' from auth.users where lower(email) = lower('jidonoso@resit.cl')
on conflict (user_id) do update set role = 'superadmin';
