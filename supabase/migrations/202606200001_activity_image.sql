-- Fase 2 del rediseño de panoramas: guardar la foto ya pagada del lugar para
-- mostrarla gratis en la timeline y al reabrir el día. Patrón idéntico a
-- 202606110001_activity_metadata.sql. Aplicar a mano en Supabase Dashboard →
-- SQL Editor (db push reporta "up to date" sin aplicar).
alter table public.activities add column if not exists image_url text;
alter table public.activities add column if not exists photo_attribution text;
