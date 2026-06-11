alter table public.activities add column if not exists tripadvisor_location_id text;
alter table public.trips add column if not exists preferences jsonb not null default '{}'::jsonb;
