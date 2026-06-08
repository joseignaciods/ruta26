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
2. Ejecutar `supabase/migrations/202606080001_initial_schema.sql`.
3. Completar:

```env
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

4. Configurar las Edge Functions y secretos:

```bash
supabase secrets set OPENAI_API_KEY=...
supabase functions deploy trip-assistant
supabase functions deploy invite-member
```

## Netlify

- Build command: `npm run build`
- Publish directory: `dist`
- Agregar las dos variables públicas de Supabase.
- No agregar `OPENAI_API_KEY` al frontend.
