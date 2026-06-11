# Ruta 26 App

Aplicación React/Vite para planificación colaborativa de múltiples viajes.

## Desarrollo local sin Supabase

```bash
cp .env.example .env.local
npm install
npm run dev
```

Con `VITE_LOCAL_DEV_MODE=true` la app usa `localStorage`. Una cuenta nueva comienza sin viajes.

## Conectar Supabase

1. Crear un proyecto Supabase de desarrollo.
2. Ejecutar, en orden:

```text
supabase/migrations/202606080001_initial_schema.sql
supabase/migrations/202606100001_assistant_and_profiles.sql
supabase/migrations/202606110001_activity_metadata.sql
supabase/migrations/202606120001_activity_done.sql
supabase/migrations/202606120002_invitation_share_token.sql
```
3. Completar:

```env
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_NOMINATIM_EMAIL=contacto@tu-dominio.com
```

4. Configurar las Edge Functions y secretos:

```bash
supabase secrets set OPENAI_API_KEY=... TRIPADVISOR_API_KEY=...
supabase functions deploy trip-assistant
supabase functions deploy invite-member
supabase functions deploy accept-invite
supabase functions deploy travel-search
```

Después de cambiar una Edge Function, volver a desplegarla. La migración adicional crea el
historial del asistente, perfiles automáticos, acceso a nombres de co-miembros y publicación
Realtime para los datos colaborativos.

### Búsqueda de lugares

El asistente usa Tripadvisor Content API mediante el secreto `TRIPADVISOR_API_KEY`. La clave
nunca se expone al frontend. Las herramientas disponibles son búsqueda por ciudad/categoría,
búsqueda por cercanía y detalles de un `location_id`.

Por las reglas de almacenamiento de Tripadvisor, las respuestas que contienen datos de este
proveedor se muestran en vivo con atribución y enlaces, pero no se guardan en
`assistant_messages`. Ruta26 no guarda ratings, fotos, reseñas ni descripciones del proveedor.
Cuando el usuario agrega un lugar, solo persiste nombre, dirección, coordenadas, categoría y
`location_id`, tal como define la política factual de la aplicación.

## Netlify

- Build command: `npm run build`
- Publish directory: `dist`
- Agregar las dos variables públicas de Supabase.
- No agregar `OPENAI_API_KEY` ni `TRIPADVISOR_API_KEY` al frontend.
