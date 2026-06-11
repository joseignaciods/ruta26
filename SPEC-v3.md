# Ruta26 — Spec v3: Composer sin tipeo · Asistente que replanifica · Mapa de ciudad

Eres un ingeniero senior trabajando en `ruta26-app`. Esta spec asume el estado actual del repo (post v2): composer de panoramas con categorías en `RouteTab.jsx`, Edge Functions `trip-assistant` (tools add_* + search en Tripadvisor) y `travel-search`, `_shared/travel-places.ts`, mapa Leaflet con vista general/por día en `MapTab.jsx`, `TodayTab`, `TripTab`, toasts, realtime y modo local dual (`hasSupabase` → `localStore`). Lee esos archivos antes de empezar.

**Reglas globales (no negociables):**
1. Dual-mode siempre: toda feature funciona en modo Supabase y degrada con gracia en modo local.
2. Cero dependencias nuevas en package.json.
3. UI en español, estilo visual existente (styles.css, paleta violeta/rosa).
4. `npm run lint` y `npm run build` pasan (usar Node 18+; con Node viejo Vite/ESLint revientan con `SyntaxError: Unexpected token .`).
5. Política Tripadvisor: nunca persistir ratings, reseñas ni descripciones de Tripadvisor en la BD. Sí se pueden persistir, cuando **el usuario decide guardar** un lugar: `name`, `address`, `latitude`, `longitude`, `category` y el `location_id` (permitido por su política para referencia). Las respuestas del chat con contenido externo siguen sin guardarse en `assistant_messages`.

---

## Bug previo obligatorio (prerequisito de todo lo demás)

`TripContext.addActivity` no persiste `latitude`/`longitude` aunque la tabla `activities` tiene ambas columnas, y `RouteTab.chooseLocalIdea` descarta `latitude`, `longitude` y `locationId` de la sugerencia elegida. Resultado: los panoramas casi nunca tienen coordenadas y el mapa de ciudad queda vacío.

- `addActivity` (Supabase y localStore) debe aceptar y guardar `latitude`, `longitude` y `tripadvisor_location_id` (ver migración más abajo).
- Al elegir una sugerencia (de Tripadvisor o locales), el composer debe arrastrar esos campos.
- Si el usuario crea un panorama manual con `address` y sin coords: geocodificar best-effort con Nominatim (`src/lib/geo.js`) al guardar, sin bloquear el flujo si falla. Nominatim exige máximo 1 request/segundo y un identificador: agregar `&email=` o header `User-Agent` propio en `geo.js`, y nunca geocodificar en loop sin throttle.

**Migración nueva** `supabase/migrations/<fecha>_activity_metadata.sql`:

```sql
alter table public.activities add column if not exists tripadvisor_location_id text;
alter table public.trips add column if not exists preferences jsonb not null default '{}'::jsonb;
```

(`preferences` se usa en el Bloque B.)

---

## Bloque A — Crear panoramas tipeando lo mínimo

Objetivo de producto: pasar de "formulario" a "elegir". El usuario debería poder agregar un panorama con 1–3 taps y, como máximo, 3 letras tipeadas.

### A1. Campo nombre = buscador con autocompletado
El input "Nombre del panorama" del composer se convierte en un autocomplete:

- Al tipear ≥3 caracteres, con debounce de 400ms, llamar `travel-search` con `{ query: texto, city: day.city, category: mapeo de la categoría activa, limit: 5 }`.
- Mostrar dropdown bajo el input: nombre, dirección corta, rating ★ (solo display, no se guarda), badge de categoría.
- Seleccionar un resultado rellena TODO: nombre, dirección, coords, locationId, categoría inferida; el usuario solo confirma. Tipeo total: 3 letras + 2 taps.
- Modo local: el autocomplete consulta `localStore.placeSuggestions(city, category)` filtrando por el texto (sin red).
- Cancelar/ignorar el dropdown permite seguir con texto libre (caso "Picnic con Anto" — no todo existe en Tripadvisor).

### A2. Hora sugerida automática
Al abrir el composer, precargar `time` con el siguiente slot razonable del día: última actividad con hora + 2h (90min si la última es `food`), partiendo de 09:30 si el día está vacío, saturando a 21:00. Helper puro `suggestNextTime(activities)` en `src/lib/planner.js` (archivo nuevo, sin dependencias). El usuario puede pisarla, pero en el caso típico no tipea hora.

### A3. Atajos de panoramas frecuentes
Sobre el category-picker del composer, fila de chips de 1 tap que crean directamente (sin pasar por el form) panoramas comunes con hora sugerida:

- "Desayuno" (food, ~09:00), "Almuerzo" (food, ~13:30), "Cena" (food, ~20:30), "Traslado" (transport, hora sugerida), "Check-in hotel" (transport→hotel si existe hotel en esa ciudad: usa su nombre y dirección).
- Crean el panorama de inmediato con nombre genérico editable después. Tipeo: cero.

### A4. "Descubrir" con quick-add
En la lista de ideas de "Descubrir en {city}" (ya existe), agregar botón `+` por idea que crea el panorama directo con hora sugerida, sin abrir el composer. Esto es acción explícita del usuario → permitido persistir los campos factuales (regla global 5). Mantener también el flujo actual de prellenar el composer (tap en la tarjeta = revisar antes; tap en `+` = agregar ya).

### A5. Filtro de categoría en Descubrir
Chips de categoría arriba de las ideas (Cultura/Comida/Naturaleza/Experiencias) que recargan `discoverPlaces(city, categoria)`. Ya existe el plumbing; falta solo la UI de chips dentro del panel de ideas.

---

## Bloque B — Asistente extremadamente inteligente (replanificación)

Hoy el asistente solo agrega. Los dos casos guía del producto son: **"el lugar X está cerrado, ayúdame"** y **"no tengo mood para este panorama, cámbialo"**. Para resolverlos necesita: poder editar el viaje, poder buscar alternativas, recibir el contexto correcto y que la UI le acerque el problema sin que el usuario tipee.

### B1. Nuevas tools de escritura en `trip-assistant`
Agregar al array `tools` y a `runTool` (todas vía el cliente user-scoped, RLS protege):

- `update_activity(activity_id, fields)` — fields parciales: name, time, description, address, category, price_label, latitude, longitude. Para "reemplazar" un panorama se prefiere update sobre delete+add (conserva posición).
- `delete_activity(activity_id)`
- `move_activity(activity_id, target_day_id, time?)` — recalcula position en el día destino (max+1).
- `update_day(day_id, fields)` — city, title, date, subtitle.
- `delete_day(day_id)` — borra en cascada sus activities (FK ya lo hace).
- `get_weather(latitude, longitude, date)` — GET a Open-Meteo (gratis, sin key, mismo contrato que `src/lib/geo.js#getWeather`). Es tool de lectura, no marca `externalContent` (datos meteorológicos públicos, sin restricción de persistencia).

Incluir las nuevas tools de escritura en `writeTools`. El contexto del viaje en el system prompt ya incluye los ids de days/activities — verificar que también incluya `address`, `latitude`, `longitude` de cada activity (necesarios para `search_nearby_places` al buscar reemplazo cercano).

### B2. Política de confirmación (system prompt)
Reglas nuevas en el system prompt:

- "Nunca uses delete_activity, delete_day, update_activity ni move_activity sin que el usuario haya confirmado explícitamente ese cambio en su último mensaje. Primero propone (2–3 opciones concretas con horario), luego espera el OK."
- "Flujo para 'lugar cerrado' o 'quiero cambiar este plan': (1) identifica la actividad en el contexto; (2) busca 2–3 alternativas reales cercanas con search_nearby_places usando sus coordenadas (o search_places con la ciudad si no hay coords), de la misma categoría salvo que el usuario pida otra cosa; (3) preséntalas con horario propuesto; (4) tras la confirmación, aplica update_activity o delete+add."
- "Si el usuario expresa desgano o cambio de ánimo sin decir qué quiere, ofrece 3 mood-options de categorías distintas (ej: algo tranquilo al aire libre / comida sin caminar mucho / dejar la tarde libre) antes de buscar."
- "Considera el clima: si la actividad es al aire libre y get_weather indica lluvia probable, adviértelo y prioriza alternativas bajo techo."

### B3. Refinar el bloqueo Tripadvisor→escritura
El bloqueo actual (write tool rechazado si hubo contenido externo en la conversación) impide TODO el flujo de reemplazo. Cambiarlo por una regla de campos:

- Las write tools quedan SIEMPRE permitidas, pero cuando en la conversación hubo datos de Tripadvisor, `runTool` sanitiza los argumentos de escritura: acepta `name`, `address`, `latitude`, `longitude`, `category`, `time`, `price_label` y `tripadvisor_location_id`; descarta cualquier `description`/`tip` que provenga del turno con datos externos (el modelo tiende a copiar descripciones de TA ahí). Concretamente: si `externalContent === true`, vaciar `description` y `tip` en add_activity/update_activity y agregar nota en el system prompt: "al guardar lugares de Tripadvisor incluye solo nombre, dirección y coordenadas; no copies su descripción".
- `changed=true` sigue gatillando refresh en el cliente. `externalContent=true` sigue impidiendo persistir la conversación en `assistant_messages` (estado actual, mantener).

### B4. Quick replies en el chat (menos tipeo también aquí)
- La function devuelve campo opcional `suggestedReplies: string[]` (máx 3, cortas). Pedirlo en el system prompt vía un formato fijo: última línea del mensaje con `///sugerencias: a | b | c`, que la function parsea, extrae y elimina del texto antes de responder. (Evita JSON-mode y mantiene compatibilidad.)
- `AssistantChat` muestra esos chips bajo la última burbuja assistant; tap = enviar como mensaje. No se persisten.

### B5. Acciones contextuales desde la ruta (cero tipeo)
La clave anti-tipeo: que la UI mande el contexto al chat, no el usuario.

- Crear `AssistantUIContext` ligero (o ampliar el lifting ya hecho en `TripWorkspace`, que controla `assistantOpen`): expone `openAssistant(initialPrompt?)`. `AssistantChat` acepta prop `initialPrompt`: al abrir con prompt, lo envía automáticamente.
- En cada `activity-line` de `RouteTab`, menú "⋯" con tres acciones que abren el chat con prompt pre-armado (incluye el id para que el modelo no adivine):
  - "Está cerrado" → `El panorama "{name}" (activity_id {id}, día {n} en {city}) está cerrado. Propón 2-3 alternativas cercanas similares y pregúntame cuál prefiero.`
  - "Cambiar por otro plan" → similar, pidiendo opciones variadas.
  - "No tengo ganas de esto" → prompt de mood-change (B2).
- En `TodayTab`, botón "Replanificar el día" que abre el chat con el resumen del día actual.
- Modo local: el menú "⋯" existe igual; el fallback local responde explicando que necesita Supabase para buscar alternativas (mantener tono útil: ofrecer borrar el panorama con las funciones locales… no — el fallback local NO ejecuta cambios; solo texto).

### B6. Preferencias del viaje (memoria del asistente)
- Columna `trips.preferences` (jsonb, migración de arriba). Forma: `{ "notes": "viajamos con un niño de 8 años, sin carne, presupuesto medio" }` — texto libre, simple.
- UI: en Config → Viaje, textarea "Notas para el asistente" (placeholder con ejemplos) que guarda en `preferences.notes` vía `updateTrip`. Dual-mode (localStore: campo en el objeto trip).
- `trip-assistant` añade al system prompt: "Preferencias del grupo: {notes}" cuando exista.
- Tool opcional `set_trip_preferences(notes)` para que el asistente actualice las notas cuando el usuario le cuenta algo durable ("somos vegetarianos") — pidiendo confirmación primero.

---

## Bloque C — Mapa de ciudad: panoramas en orden, con número y categoría

Estado actual de `MapTab`: vista por día ya traza polyline entre actividades con coords, pero los pins de actividades son `circleMarker` rosas idénticos, sin número ni categoría. Con el bug previo arreglado (coords persistidas), mejorar:

### C1. Pins numerados por categoría
- Reemplazar los `circleMarker` de actividades por `L.divIcon` HTML: círculo de ~30px con **el número de orden dentro del día** (índice por `position`, 1..n) y un mini-anillo/fondo del color de su categoría, más el icono SVG de la categoría (reusar los paths de `CategoryIcon` de RouteTab — extraerlos a `src/components/CategoryIcon.jsx` compartido para no duplicar).
- Layout sugerido del pin: número grande al centro, icono de categoría pequeño en badge inferior-derecha. Debe leerse a simple vista qué es (comida, museo, naturaleza...) y en qué orden va.
- Paleta por categoría (consistente en pins, leyenda y RouteTab): `culture #8b5cf6`, `food #f59e0b`, `nature #10b981`, `entertainment #c44e92`, `transport #64748b`.
- Hotel: pin propio (icono cama, fondo blanco con borde violeta), sin número.
- Popup: `n. nombre · hora · categoría · dirección`.

### C2. Orden visible y leyenda
- En vista por día, la polyline conecta los panoramas **en orden de position** (verificar que el array vaya ordenado; el contexto ya ordena por position). Flechas no son necesarias; el número en el pin comunica el orden.
- Leyenda compacta bajo el mapa (chips de color+icono+label por categoría presente en el día). Reusar el componente CategoryIcon compartido.

### C3. Panoramas sin ubicación
- Bajo el mapa en vista por día, lista "Sin ubicación en el mapa" con los panoramas sin coords y botón "Ubicar": intenta geocodificar `address` (si existe) con Nominatim y persiste las coords vía `updateActivity`; si no hay address, abre el composer/autocomplete (A1) en modo edición para buscarlo en Tripadvisor.
- Necesita `updateActivity(dayId, activityId, fields)` en TripContext + localStore (también lo usa B1 desde el lado servidor — son caminos distintos, este es el del cliente).

### C4. Centrado de ciudad
- En vista por día: si hay actividades con coords, `fitBounds` sobre ellas (la ciudad geocodificada solo como fallback). Hoy el pin de ciudad puede arrastrar el zoom lejos del barrio de los panoramas; en vista por día el marker grande de ciudad sobra si ya hay pins de actividades — mostrarlo solo cuando no hay ninguna actividad con coords.

---

## Orden de implementación y aceptación

Orden: **Bug previo → C (mapa) → A (composer) → B (asistente)**. C y A son visibles de inmediato y no tocan la function; B concentra el riesgo (probarlo al final con calma).

Criterios de aceptación:
1. Crear panorama eligiendo sugerencia de Tripadvisor: queda con coords y aparece numerado y coloreado por categoría en el mapa del día, conectado en orden.
2. Crear panorama con los chips de atajo: 1 tap, sin tipear, con hora razonable.
3. Autocomplete: tipear "lou" en un día en París ofrece el Louvre; elegirlo rellena dirección y coords.
4. Chat: "el Louvre está cerrado" → el asistente propone 2–3 alternativas reales cercanas con fuente Tripadvisor y, tras decir "ok la 2", la ruta queda actualizada (update_activity) sin perder el orden del día.
5. Menú "⋯" de un panorama → "No tengo ganas de esto" → chat abre, pregunta mood con quick-reply chips, reemplaza tras confirmación.
6. En la BD no queda guardado ningún rating/reseña/descripción de Tripadvisor; sí nombre/dirección/coords/location_id.
7. Modo local: composer, atajos, mapa (con coords manuales) y menú "⋯" no rompen; el fallback local explica sus límites.
8. `npm run lint` y `npm run build` (Node 18+) pasan.
