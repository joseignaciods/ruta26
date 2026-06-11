# Ruta26 — Plan de implementación v3

Referencia técnica: [SPEC-v3.md](SPEC-v3.md). Este plan parte el trabajo en 5 sesiones de Codex, ordenadas por dependencia y riesgo (lo visible primero, la function al final). Cada sesión incluye el prompt listo para pegar, los archivos que toca y el QA manual para dar por cerrada la sesión antes de pasar a la siguiente.

## Estado

| # | Sesión | Bloques del spec | Estado |
|---|--------|------------------|--------|
| 0 | Fundaciones: coords + migración | Bug previo | ✅ Implementada (Claude, 2026-06-10) |
| 1 | Mapa de ciudad | C1–C4 | ✅ Implementada (Claude, 2026-06-10) |
| 2 | Composer sin tipeo | A1–A5 | ✅ Implementada (Claude, 2026-06-10) |
| 3 | Asistente: backend replanificador | B1, B2, B3, B6 (BD) | ✅ Implementada (Claude, 2026-06-10) |
| 4 | Asistente: UI contextual | B4, B5, B6 (UI) | ✅ Implementada (Claude, 2026-06-10) |

`npm run lint && npm run build` en verde tras las 5 sesiones.

**Pendiente del lado del usuario (no automatizable desde aquí):**
1. Correr `supabase/migrations/202606110001_activity_metadata.sql` en el proyecto Supabase.
2. `supabase functions deploy trip-assistant` (la function cambió: tools de edición, clima, preferencias, quick replies).
3. QA manual de cada sesión (listas abajo) — en especial el flujo "está cerrado" → reemplazo con confirmación.

**Notas de implementación (difieren levemente del spec):**
- A4: las ideas de Tripadvisor ahora tienen botón `+` (agregar directo) y "Editar" (prellenar composer); se eliminó la restricción de solo-link. Solo se persisten nombre, dirección, coords y location_id.
- B3: la sanitización vacía `description` en add/update_activity cuando hubo datos de Tripadvisor en la conversación; el system prompt además lo prohíbe.
- B5: se usó lifting de estado en TripWorkspace (`openAssistant(prompt)` vía props) en lugar de un contexto nuevo — menos código, mismo resultado.

---

## Sesión 0 — Fundaciones (bug de coordenadas + migración)

**Objetivo:** que todo panorama nuevo pueda quedar con coordenadas persistidas. Sin esto, el mapa (S1) y el reemplazo cercano del asistente (S3) no funcionan.

**Archivos:** `supabase/migrations/` (nueva), `src/state/TripContext.jsx`, `src/lib/localStore.js`, `src/components/RouteTab.jsx`, `src/lib/geo.js`.

**Tareas:**
- [ ] Migración `<fecha>_activity_metadata.sql`: `activities.tripadvisor_location_id text` + `trips.preferences jsonb default '{}'` (la columna preferences se usa recién en S3/S4, pero viaja en esta migración para tocar la BD una sola vez).
- [ ] `addActivity` acepta y persiste `latitude`, `longitude`, `tripadvisorLocationId` (Supabase: columnas snake_case; localStore: mismas llaves camelCase). `mapActivity` ya mapea lat/lng — verificar que incluya el locationId.
- [ ] `RouteTab.chooseLocalIdea` arrastra `latitude`, `longitude`, `locationId` de la idea elegida al form (hoy los bota).
- [ ] Panorama manual con `address` y sin coords: geocodificar best-effort con `geocodeCity`-style request a Nominatim al guardar; si falla, guardar sin coords sin bloquear ni mostrar error.
- [ ] `geo.js`: agregar identificador a Nominatim (parámetro `email=` o header `User-Agent`) y no permitir más de 1 request/segundo (throttle simple con timestamp en módulo).

**Prompt para Codex:**
> Lee SPEC-v3.md del repo, sección "Bug previo obligatorio". Implementa exactamente eso: migración activity_metadata, persistencia de latitude/longitude/tripadvisor_location_id en addActivity (dual-mode Supabase + localStore), arrastre de coords/locationId al elegir sugerencia en RouteTab, geocodificación best-effort de address al crear panorama manual, y el throttle + identificador de Nominatim en geo.js. Respeta las "Reglas globales" del spec. No toques nada de los Bloques A, B o C todavía.

**QA manual:**
1. Modo Supabase: agregar panorama eligiendo idea de "Descubrir" → la fila en `activities` tiene `latitude`, `longitude`, `tripadvisor_location_id`.
2. Panorama manual con dirección real → coords aparecen (o queda sin coords sin error visible si Nominatim falla).
3. Modo local: mismo flujo sin red no rompe.

**Post-sesión:** correr la migración en Supabase (`supabase db push` o SQL editor).

---

## Sesión 1 — Mapa de ciudad (Bloque C)

**Objetivo:** en la vista por día, los panoramas se ven numerados en orden, con color e icono de categoría, conectados por la ruta del día.

**Archivos:** `src/components/MapTab.jsx`, `src/components/RouteTab.jsx`, `src/components/CategoryIcon.jsx` (nuevo), `src/state/TripContext.jsx`, `src/lib/localStore.js`, `src/styles.css`.

**Tareas:**
- [ ] Extraer `CategoryIcon` de RouteTab a componente compartido `src/components/CategoryIcon.jsx`; RouteTab lo importa.
- [ ] Pins de actividades: `L.divIcon` con número de orden (1..n por position dentro del día) + color de categoría + badge con icono (C1). Paleta: culture `#8b5cf6`, food `#f59e0b`, nature `#10b981`, entertainment `#c44e92`, transport `#64748b`.
- [ ] Pin de hotel propio (icono cama, fondo blanco, borde violeta), sin número.
- [ ] Popup: `n. nombre · hora · categoría · dirección`.
- [ ] Leyenda bajo el mapa con las categorías presentes en el día (C2).
- [ ] Vista por día: `fitBounds` sobre las actividades con coords; marker de ciudad solo si ninguna actividad tiene coords (C4).
- [ ] Lista "Sin ubicación en el mapa" + botón "Ubicar" que geocodifica address y persiste vía `updateActivity` nuevo en TripContext + localStore (C3). Si no hay address, por ahora solo mostrar hint (la edición con autocomplete llega en S2).

**Prompt para Codex:**
> Lee SPEC-v3.md, Bloque C completo (C1–C4). Impleméntalo. Prerrequisito ya hecho: las actividades persisten coords. Extrae CategoryIcon a componente compartido, usa L.divIcon para pins numerados por categoría con la paleta del spec, leyenda, pin de hotel, centrado por actividades y la lista "Sin ubicación" con updateActivity dual-mode. Cuidado con los dos gotchas de Leaflet ya documentados en el código: iconos default rotos en Vite (por eso divIcon) y map.remove() en el cleanup por StrictMode.

**QA manual:**
1. Día con 3 panoramas con coords de categorías distintas → 3 pins numerados 1-2-3, colores distintos, polyline en orden.
2. Hotel con coords → pin distinto sin número.
3. Panorama sin coords → aparece en "Sin ubicación"; "Ubicar" con dirección válida lo sube al mapa.
4. Vista general sigue funcionando (ciudades numeradas + ruta entre ciudades).

---

## Sesión 2 — Composer sin tipeo (Bloque A)

**Objetivo:** agregar un panorama con 1–3 taps y máximo 3 letras tipeadas.

**Archivos:** `src/components/RouteTab.jsx`, `src/lib/planner.js` (nuevo), `src/state/TripContext.jsx` (si el autocomplete necesita una variante de `discoverPlaces` con query libre), `src/lib/localStore.js`, `src/styles.css`.

**Tareas (en este orden interno):**
- [ ] A2 — `suggestNextTime(activities)` en `src/lib/planner.js` (puro, sin deps); el composer precarga la hora.
- [ ] A3 — chips de atajo (Desayuno/Almuerzo/Cena/Traslado/Check-in hotel) que crean directo con hora típica; check-in usa el hotel de la ciudad si existe.
- [ ] A4 — botón `+` quick-add en cada idea de "Descubrir" (crea directo con hora sugerida y coords).
- [ ] A5 — chips de categoría dentro del panel de ideas que recargan `discoverPlaces`.
- [ ] A1 — autocomplete en el campo nombre: debounce 400ms, ≥3 caracteres, dropdown con nombre/dirección/rating (rating solo display), seleccionar rellena todo; texto libre sigue funcionando. Modo local: filtra `localStore.placeSuggestions`.

**Prompt para Codex:**
> Lee SPEC-v3.md, Bloque A completo (A1–A5). Implementa en este orden: A2 (planner.js con suggestNextTime), A3 (chips de atajo), A4 (quick-add en Descubrir), A5 (filtro de categoría en ideas), y al final A1 (autocomplete del campo nombre con debounce 400ms contra travel-search, fallback local con placeSuggestions). Recuerda la regla global 5 del spec: al persistir desde sugerencias solo campos factuales (nombre, dirección, coords, location_id, categoría); el rating se muestra pero no se guarda.

**QA manual:**
1. Abrir composer en día con actividades → hora ya viene propuesta (última + 2h).
2. Chip "Almuerzo" → panorama food creado con un tap.
3. Tipear "lou" en día en París → dropdown ofrece el Louvre; elegirlo rellena dirección y coords; aparece en el mapa (S1).
4. `+` en una idea de Descubrir → creado directo, con coords.
5. En la BD: ningún rating/reseña guardado.

---

## Sesión 3 — Asistente: backend replanificador (Bloque B, servidor)

**Objetivo:** el asistente puede editar el viaje (no solo agregar), buscar alternativas y respetar la política propone→confirma. La sesión más riesgosa: solo backend, probar con calma.

**Archivos:** `supabase/functions/trip-assistant/index.ts`, `src/state/TripContext.jsx` + `src/screens/TripWorkspace.jsx` (solo lo mínimo para preferences en BD si hace falta), migración ya corrida en S0.

**Tareas:**
- [ ] B1 — tools nuevas: `update_activity`, `delete_activity`, `move_activity`, `update_day`, `delete_day`, `get_weather` (Open-Meteo, lectura, no marca externalContent). Incluir las de escritura en `writeTools`. Verificar que el contexto del system prompt incluya address/lat/lng por actividad.
- [ ] B2 — system prompt: regla de confirmación explícita para tools destructivas + flujo "lugar cerrado" + flujo "mood" + considerar clima.
- [ ] B3 — reemplazar el bloqueo total Tripadvisor→escritura por sanitización de campos: con `externalContent`, las escrituras vacían `description`/`tip` y solo aceptan campos factuales.
- [ ] B6 (parte BD) — leer `trips.preferences.notes` y agregarlo al system prompt; tool `set_trip_preferences(notes)` con confirmación.

**Prompt para Codex:**
> Lee SPEC-v3.md, Bloque B secciones B1, B2, B3 y B6 (solo la parte de backend: leer trips.preferences en el system prompt y la tool set_trip_preferences). Trabaja únicamente en supabase/functions/trip-assistant/index.ts salvo que necesites tipos compartidos. Mantén el patrón actual: loop de Responses API, runTool con cliente user-scoped, writeTools/externalTools. El cambio de B3 es delicado: NO elimines la protección de contenido externo, transfórmala en sanitización de campos exactamente como describe el spec.

**QA manual (con functions desplegadas en un proyecto de prueba):**
1. "El [panorama] está cerrado" → propone 2–3 alternativas reales cercanas, NO modifica nada aún.
2. "Ok, la segunda" → `update_activity` aplicado, orden del día intacto, `changed=true`, la UI refresca.
3. "Bórralo no más" → pide/respeta confirmación antes de `delete_activity`.
4. Revisar en BD que la actividad reemplazada no tenga descripción copiada de Tripadvisor.
5. Conversación con datos de Tripadvisor sigue sin guardarse en `assistant_messages`.

**Post-sesión:** `supabase functions deploy trip-assistant`.

---

## Sesión 4 — Asistente: UI contextual (Bloque B, cliente)

**Objetivo:** que el usuario no tipee para pedir ayuda: la UI manda el contexto al chat.

**Archivos:** `src/components/AssistantChat.jsx`, `src/components/RouteTab.jsx`, `src/components/TodayTab.jsx`, `src/screens/TripWorkspace.jsx`, `src/state/` (AssistantUIContext o ampliación del lifting actual), `supabase/functions/trip-assistant/index.ts` (solo el parseo de `///sugerencias:`), `src/styles.css`.

**Tareas:**
- [ ] B4 — quick replies: la function parsea la última línea `///sugerencias: a | b | c`, la quita del texto y devuelve `suggestedReplies`; AssistantChat los muestra como chips bajo la última burbuja (tap = enviar). No se persisten.
- [ ] B5 — `openAssistant(initialPrompt?)` (contexto ligero o props desde TripWorkspace); menú "⋯" en cada activity-line con "Está cerrado / Cambiar por otro plan / No tengo ganas de esto" → abre chat con prompt pre-armado (incluye activity_id, día y ciudad); botón "Replanificar el día" en TodayTab.
- [ ] B6 (parte UI) — textarea "Notas para el asistente" en Config → Viaje, persiste en `preferences.notes` vía `updateTrip` dual-mode.
- [ ] Modo local: menú "⋯" abre el chat y el fallback explica sus límites sin ejecutar cambios.

**Prompt para Codex:**
> Lee SPEC-v3.md, Bloque B secciones B4, B5 y B6 (parte UI). El backend ya soporta replanificación y set_trip_preferences. Implementa: parseo de ///sugerencias: en la function y chips de quick-reply en AssistantChat; openAssistant(initialPrompt) con envío automático; menú "⋯" por panorama con los tres prompts pre-armados del spec; "Replanificar el día" en TodayTab; textarea de notas para el asistente en Config → Viaje persistiendo en trips.preferences (dual-mode).

**QA manual:**
1. "⋯" → "Está cerrado" → chat se abre, manda solo el prompt, llegan alternativas con chips de respuesta; tap en chip responde sin tipear.
2. "Replanificar el día" en Hoy funciona igual.
3. Notas "somos vegetarianos" en Config → pedir restaurantes → las sugerencias lo respetan.
4. Modo local: todo abre y degrada sin errores.

---

## Riesgos y contingencias

- **S3 es la sesión frágil** (prompt-engineering + sanitización). Si Codex rompe el loop de tools, hacer rollback de la function (git) y reintentar solo B1 primero, luego B2/B3 en un segundo prompt.
- **Tripadvisor sin key o con cuota agotada:** todo el plan degrada — autocomplete y Descubrir caen al fallback local; el asistente avisa que no puede buscar lugares reales (ya contemplado en el system prompt actual).
- **Nominatim rate-limit:** si el mapa geocodifica muchas ciudades de golpe, el throttle de S0 lo cubre; no paralelizar geocodificaciones.
- **Migraciones:** S0 toca BD una sola vez; S1–S4 no agregan migraciones. Si se corre S3 sin haber aplicado la migración de S0, `set_trip_preferences` fallará — el orden del plan lo evita.

## Checklist de cierre (después de S4)

- [ ] Los 8 criterios de aceptación de SPEC-v3.md pasan.
- [ ] Migración aplicada en el proyecto Supabase real.
- [ ] `supabase functions deploy trip-assistant travel-search invite-member`.
- [ ] Deploy Netlify con build verde.
- [ ] Probar flujo completo en móvil real: crear día → chips de atajo → autocomplete → mapa → "está cerrado" → reemplazo.
