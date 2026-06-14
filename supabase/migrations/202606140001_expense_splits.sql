-- Gastos estilo Splitwise: división embebida + enlace a panoramas/hoteles.

-- División por gasto (quién participa y cuánto le toca, ya resuelto).
-- Forma: {"mode":"equal|shares|exact|percent","members":["uuid"],
--         "amounts":{"uuid":n},"weights":{"uuid":n}}. {} => igualitario en runtime.
alter table public.expenses
  add column if not exists split jsonb not null default '{}'::jsonb;

-- Enlace a hotel (el gasto sobrevive si se borra el hotel: el dinero ya se gastó).
alter table public.expenses
  add column if not exists hotel_id uuid references public.hotels(id) on delete set null;

-- Marca transferencias de settle-up (se excluyen de los totales).
alter table public.expenses
  add column if not exists is_settlement boolean not null default false;

-- El gasto enlazado a un panorama también debe sobrevivir si se borra el panorama.
-- Hoy activity_id es ON DELETE CASCADE; lo pasamos a SET NULL.
alter table public.expenses
  drop constraint if exists expenses_activity_id_fkey;
alter table public.expenses
  add constraint expenses_activity_id_fkey
  foreign key (activity_id) references public.activities(id) on delete set null;

-- Costo del hotel (para poder registrarlo como gasto).
alter table public.hotels
  add column if not exists cost numeric(12,2);
alter table public.hotels
  add column if not exists cost_currency text not null default '';

create index if not exists expenses_activity_id_idx on public.expenses(activity_id);
create index if not exists expenses_hotel_id_idx on public.expenses(hotel_id);
