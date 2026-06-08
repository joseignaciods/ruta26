create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  currency text not null default 'USD',
  timezone text not null default 'America/Santiago',
  owner_id uuid not null references auth.users(id),
  ai_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor')),
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  unique(trip_id,user_id)
);

create table public.trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor')),
  token_hash text not null default encode(gen_random_bytes(32),'hex'),
  status text not null default 'pending',
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  unique(trip_id,email)
);

create table public.days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  position integer not null,
  date date,
  city text not null,
  title text not null,
  subtitle text not null default '',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id,position)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_id uuid not null references public.days(id) on delete cascade,
  position integer not null,
  name text not null,
  time text,
  duration text,
  category text not null default 'entertainment',
  description text not null default '',
  tip text not null default '',
  address text not null default '',
  latitude double precision,
  longitude double precision,
  is_free boolean not null default false,
  price_label text not null default '',
  expense_amount numeric(12,2),
  expense_currency text not null default 'USD',
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(day_id,position)
);

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  city text not null,
  name text not null,
  address text not null default '',
  check_in date,
  check_out date,
  confirmation text not null default '',
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  category text not null default 'activity',
  date date,
  paid_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.packing_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  item text not null,
  category text not null default 'essential',
  packed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  type text not null default 'other',
  storage_path text,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index trip_members_user_idx on public.trip_members(user_id,trip_id);
create index days_trip_idx on public.days(trip_id,position);
create index activities_trip_day_idx on public.activities(trip_id,day_id,position);

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=(select auth.uid()) and status='active') $$;

create or replace function public.is_trip_owner(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=(select auth.uid()) and role='owner' and status='active') $$;

create or replace function public.create_trip(
  p_name text, p_start_date date default null, p_end_date date default null,
  p_currency text default 'USD', p_timezone text default 'America/Santiago'
) returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid;
begin
  insert into public.trips(name,start_date,end_date,currency,timezone,owner_id)
  values(p_name,p_start_date,p_end_date,p_currency,p_timezone,(select auth.uid()))
  returning id into new_id;
  insert into public.trip_members(trip_id,user_id,role)
  values(new_id,(select auth.uid()),'owner');
  return new_id;
end $$;

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invitations enable row level security;
alter table public.days enable row level security;
alter table public.activities enable row level security;
alter table public.hotels enable row level security;
alter table public.expenses enable row level security;
alter table public.packing_items enable row level security;
alter table public.documents enable row level security;

create policy "profiles self read" on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy "profiles self update" on public.profiles for update to authenticated using ((select auth.uid())=id);

create policy "members read trips" on public.trips for select to authenticated using (public.is_trip_member(id));
create policy "members update trips" on public.trips for update to authenticated using (public.is_trip_member(id)) with check (public.is_trip_member(id));
create policy "owners delete trips" on public.trips for delete to authenticated using (public.is_trip_owner(id));

create policy "members read membership" on public.trip_members for select to authenticated using (public.is_trip_member(trip_id));
create policy "owners manage membership" on public.trip_members for all to authenticated using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));
create policy "owners manage invitations" on public.trip_invitations for all to authenticated using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));

create policy "members manage days" on public.days for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy "members manage activities" on public.activities for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy "members manage hotels" on public.hotels for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy "members manage expenses" on public.expenses for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy "members manage packing" on public.packing_items for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy "members manage documents" on public.documents for all to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
