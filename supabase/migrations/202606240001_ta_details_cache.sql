-- Caché compartida de fichas de Tripadvisor (location details). Evita gastar una
-- unidad de cuota por el mismo lugar más de una vez cada 30 días. Solo la edge
-- function la lee/escribe con el service role (RLS sin políticas = sin acceso para
-- usuarios autenticados/anónimos). Aplicada a mano en el SQL Editor el 2026-06-24.
create table if not exists public.ta_details_cache (
  location_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.ta_details_cache enable row level security;
