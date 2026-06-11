create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index assistant_messages_trip_idx on public.assistant_messages(trip_id, created_at);
alter table public.assistant_messages enable row level security;
create policy "members manage assistant messages" on public.assistant_messages
  for all to authenticated
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- Los miembros de un viaje pueden ver los perfiles de sus co-miembros.
-- La política original solo permite leer el perfil propio, dejando nombres invisibles en la UI.
create policy "members read co-member profiles" on public.profiles
  for select to authenticated
  using (exists (
    select 1 from public.trip_members tm1
    join public.trip_members tm2 on tm1.trip_id = tm2.trip_id
    where tm1.user_id = (select auth.uid()) and tm2.user_id = profiles.id
  ));

-- Crear profile automáticamente al registrarse (la tabla quedaba vacía).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Realtime para colaboración en vivo (RLS aplica también a realtime).
alter publication supabase_realtime add table
  public.days, public.activities, public.hotels,
  public.expenses, public.packing_items, public.assistant_messages;
