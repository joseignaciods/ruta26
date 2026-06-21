-- Mejoras de hoteles + Wallet (Cartera) de adjuntos.
-- Aplicar a mano en Supabase Dashboard → SQL Editor.

-- 1) Hoteles: enlace a la reserva (Booking/Airbnb/etc).
alter table public.hotels add column if not exists url text;

-- 2) Wallet: reutilizamos la tabla documents existente, vinculándola a un
--    panorama (activity) y guardando el autor + tipo MIME. La policy
--    "members manage documents" ya existe y cubre el CRUD por miembros.
alter table public.documents add column if not exists activity_id uuid references public.activities(id) on delete set null;
alter table public.documents add column if not exists created_by uuid references auth.users(id);
alter table public.documents add column if not exists mime text not null default '';

-- 3) Almacenamiento privado para los archivos (imágenes, PDF, QR, tickets).
insert into storage.buckets (id, name, public)
values ('wallet', 'wallet', false)
on conflict (id) do nothing;

-- 4) Políticas de Storage: solo miembros del viaje. La ruta de cada objeto es
--    "{trip_id}/{archivo}", así que el primer segmento es el trip_id.
drop policy if exists "wallet read" on storage.objects;
drop policy if exists "wallet insert" on storage.objects;
drop policy if exists "wallet delete" on storage.objects;

create policy "wallet read" on storage.objects for select to authenticated
  using (bucket_id = 'wallet' and public.is_trip_member(((storage.foldername(name))[1])::uuid));

create policy "wallet insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'wallet' and public.is_trip_member(((storage.foldername(name))[1])::uuid));

create policy "wallet delete" on storage.objects for delete to authenticated
  using (bucket_id = 'wallet' and public.is_trip_member(((storage.foldername(name))[1])::uuid));
