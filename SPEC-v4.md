# Ruta26 — Spec v4: Pulido de UI por vista + sesiones de implementación

Eres un ingeniero senior trabajando en `ruta26-app`. **Prerrequisito: SPEC-v3.md implementado completo** (coords persistidas, mapa con pins por categoría, composer con autocomplete, asistente replanificador). Esta spec mejora la experiencia de las vistas existentes. Lee los archivos involucrados antes de cada sesión.

**Reglas globales (idénticas a v3, no negociables):**
1. Dual-mode siempre (Supabase + localStore).
2. Cero dependencias nuevas en package.json.
3. UI en español, estilo visual existente (styles.css, paleta violeta/rosa).
4. `npm run lint` y `npm run build` pasan (Node 18+).
5. Nada de Tripadvisor persistido salvo campos factuales (regla 5 de v3).

**Migración única de v4** (correr en la Sesión 1, la BD se toca una sola vez):

```sql
alter table public.activities add column if not exists done boolean not null default false;
```

---

## Bloque D — Fluidez (transversal)

### D1. Optimistic UI
Hoy TODA mutación termina en `refresh()`: marcar un ítem de equipaje refetchea el viaje completo (días, gastos, hoteles, perfiles). En red móvil cada tap se siente lento.

- Refactor en `TripContext`: cada mutación aplica primero el cambio sobre el estado local (`setTrips` con el siguiente estado calculado), dispara la escritura remota en segundo plano y solo ante error hace `refresh()` + toast (reconciliación, no rollback granular).
- Mantener `refresh()` como reconciliador: tras éxito remoto NO es necesario refetchear si el cambio local ya es equivalente; conservar el refresh de realtime (debounced) como red de seguridad.
- No cambiar las firmas públicas de las mutaciones (los componentes no deben tocarse salvo donde dependan del retorno).
- Modo local ya es síncrono: sin cambios funcionales, pero debe seguir pasando por el mismo camino.

### D2. Borrar con deshacer (reemplaza confirms)
- Eliminar `confirm()` nativo de `deleteDay` y unificar TODOS los borrados (día, panorama, hotel, gasto, ítem equipaje): borran de inmediato (optimistic) y muestran toast "Eliminado · **Deshacer**" por 5 segundos.
- Deshacer = recrear el registro con los mismos datos (en Supabase será un id nuevo; aceptable). Implementar en `ToastContext` un toast con acción: `toast(message, { action: { label, onClick } })`, retrocompatible con la firma actual.
- El borrado remoto se ejecuta de inmediato; "Deshacer" reinserta. (Simple y robusto; no diferir el delete.)

### D3. Skeletons
- Reemplazar "Cargando viaje..." y "Cargando viajes..." por skeletons: 3 cards grises pulsantes con las proporciones de `day-card`/`trip-card`. CSS puro (`@keyframes` shimmer), un componente `Skeleton` pequeño reutilizable.

---

## Bloque E — "Hoy" como vista en-viaje

### E1. Indicador de ahora + estado por hora
- En el timeline, calcular la hora actual en el timezone del viaje. Actividades con hora anterior → atenuadas (`opacity .55`); la actividad en curso (entre su hora y la siguiente) → resaltada con borde/acento; línea horizontal "ahora" posicionada entre ítems.
- Solo aplica cuando el día mostrado ES hoy; en días futuros el timeline se muestra normal.

### E2. Check de hecho
- Columna `activities.done` (migración de arriba). Checkbox/círculo tappeable en cada ítem del timeline de Hoy (y opcionalmente en Ruta): marca hecho, tacha el nombre.
- Contador en el hero: "2 de 5 panoramas hechos". `toggleActivityDone(dayId, activityId)` en TripContext + localStore (optimistic, D1).

### E3. Cómo llegar
- Tap en una actividad del timeline → abrir Google Maps: con coords `https://www.google.com/maps/search/?api=1&query={lat},{lng}`; sin coords pero con address, usar la dirección URL-encoded; sin ninguna, no mostrar el botón.
- Icono/botón discreto por ítem (flecha de navegación), `target="_blank"`.
- Mismo enlace en los popups del mapa y en las cards de hotel.

### E4. Navegación entre días
- Flechas ← → en el hero de Hoy para moverse al día anterior/siguiente (orden por position). El label cambia a "DÍA {n} · {fecha}" cuando no es hoy. Botón "volver a hoy" si el usuario navegó.

### E5. Fechas humanas
- Helper `formatDate(iso)` en `src/lib/planner.js`: "Mié 15 oct" (usar `Intl.DateTimeFormat('es-CL')`). Aplicarlo en Hoy, Ruta (day-cards), TripsPage y hoteles. Mantener ISO solo en inputs.

---

## Bloque F — Ruta editable

### F1. Editar panoramas y días
- Tap en una activity-line (zona de texto, no el ✕) → abre el composer en **modo edición** prellenado; guardar llama `updateActivity` (ya existe desde v3-C3; ampliarlo a todos los campos del composer).
- Editar día: botón lápiz en el day-head expandido → modal de día prellenado → `updateDay(dayId, fields)` nuevo en TripContext + localStore.

### F2. Reordenar con ↑ ↓
- En el day-body, cada activity-line en un modo "ordenar" (toggle pequeño "Ordenar" junto al heading del día) muestra botones ↑ ↓ que intercambian `position` con el vecino. Nada de drag & drop (móvil + sin deps).
- Supabase: swap de positions en dos updates (cuidado con `unique(day_id,position)`: usar posición temporal negativa o actualizar en orden seguro). LocalStore: swap directo en el array.
- Mismo patrón para reordenar días (`unique(trip_id,position)`).

### F3. Preview de categorías en day-card colapsada
- En la day-card sin expandir, fila de mini-iconos (CategoryIcon compartido, 14px) con las categorías de sus panoramas, en orden, máximo 6 y "+n". Reemplaza/acompaña el texto "{n} panoramas".

### F4. Duración y huecos
- Exponer el campo `duration` (texto libre corto: "2h", "45min") en el composer (opcional, después de hora) y mostrarlo en la línea: "10:00 · 2h".
- Si el trip tiene `startDate`, al crear un día sin fecha sugerir automáticamente `startDate + (position - 1)` días en el input de fecha del modal.

---

## Bloque G — Gastos y equipaje

### G1. Quick-add de gastos
- Reemplazar el form largo por una línea siempre visible arriba: `[monto] [descripción] [+]`, con defaults: moneda del viaje, fecha de hoy, pagador = usuario actual. Link "más opciones" expande moneda/fecha/pagador.
- Registrar un café = tipear monto y nombre, un tap.

### G2. Transferencias sugeridas (settle-up)
- Nueva función pura `settleUp(balances)` en `src/lib/settle.js`: greedy entre mayores acreedores y deudores, devuelve lista mínima de transferencias `{ from, to, amount }`.
- En la balance-card por moneda, debajo de los netos: "Para quedar al día: Anto → José $25.000". Sin estado nuevo, derivado.

### G3. Categorías de gasto visibles
- El schema ya tiene `expenses.category`. Selector de chips en el quick-add expandido (comida, transporte, alojamiento, actividad, otros) y mini-icono en cada list-card. Filtro simple por pagador (chips con los miembros) sobre la lista.

### G4. Plantillas de equipaje
- Botones al crear lista vacía: "Playa", "Ciudad", "Trekking", "Internacional" → insertan 10–15 ítems típicos (arrays estáticos en el componente). Más botón "Generar con IA" que abre el asistente con prompt pre-armado ("arma mi lista de equipaje para este viaje considerando destino, fechas y clima") — el asistente necesita tool `add_packing_item` en `trip-assistant` (agregarla, misma mecánica que las demás write tools).

---

## Bloque H — Shell, acceso y página de viajes

### H1. PWA instalable + safe areas
- `public/manifest.webmanifest` (name, short_name "Ruta26", theme_color `#8b5cf6`, background `#ece8ff`, display standalone, iconos 192/512 — generar PNGs simples con el gradiente y "R26"). Link en `index.html` + `<meta name="theme-color">` + `apple-touch-icon`.
- CSS: `padding-bottom: calc(12px + env(safe-area-inset-bottom))` en `.workspace-nav`; `viewport-fit=cover` en el meta viewport. Sin service worker en esta versión (offline viene de H2, no de cache de assets).

### H2. Snapshot offline (solo lectura)
- En cada `refresh()` exitoso (modo Supabase), guardar `trips` serializado en localStorage (`ruta26_snapshot`).
- Si `refresh()` falla por red (offline), hidratar desde el snapshot y mostrar banner fijo "Sin conexión — mostrando última copia". Las escrituras fallarán con toast normal; aceptable.

### H3. Cards de Mis viajes
- Countdown: "Faltan 23 días" (startDate futura), "En curso · día 3 de 8" (entre fechas), "Finalizado" (endDate pasada). Badge de estado con color.
- Cover con color determinístico: hash del nombre → índice en una paleta de 6 gradientes predefinidos.
- Orden: en curso primero, luego próximos por fecha, luego pasados.

### H4. Config: zona de peligro y miembros
- "Eliminar viaje" (solo owner; la policy de BD ya existe): sección al final de Config → Viaje, botón rojo, confirmación tipeando el nombre del viaje (excepción justificada al patrón undo: irreversible y total). `deleteTrip` nuevo en TripContext + localStore; al borrar, navegar a /trips.
- Miembros con avatar de iniciales (color por hash del nombre) y etiqueta "(tú)" en el usuario actual.

### H5. Aceptar invitación
- Hoy el token de `trip_invitations` no lo consume nadie. Nueva Edge Function `accept-invite`: recibe `{ token }`, valida hash + expiración + que el email del usuario autenticado coincida con la invitación, inserta `trip_members` (service role) y marca la invitación `accepted`.
- Ruta `/join/:token` en App.jsx: si no hay sesión, guarda el token y redirige a login/registro; con sesión llama la function y navega al viaje. El mail de invitación (cuando se conecte Resend) apuntará aquí; mientras tanto, en Config → Participantes mostrar el link copiable por invitación pendiente.
- Modo local: botón "simular aceptación" no aplica — ocultar el link en local.

### H6. Acceso sin contraseña
- En AuthPage, opción "Entrar con link mágico": pide solo email, llama `supabase.auth.signInWithOtp({ email })`, muestra "Revisa tu correo". Solo visible en modo Supabase. Mantener password como alternativa. Agregar "¿Olvidaste tu contraseña?" con `resetPasswordForEmail`.

---

## Bloque I — Chat pulido

### I1. Markdown ligero en burbujas
- Mini-renderer propio (sin deps) en AssistantChat: **negritas**, listas con `-`/`1.`, links `[texto](url)` y saltos de línea. Nada más. Sanitizar: render con elementos React, jamás `dangerouslySetInnerHTML`.

### I2. Tarjetas de acción
- `trip-assistant` acumula resúmenes de las write tools ejecutadas y los devuelve como `actions: [{ tool, label, id }]` (ej: `{ tool:'add_activity', label:'Louvre → Día 2', id:'<uuid>' }`).
- AssistantChat las muestra como mini-cards bajo la burbuja (icono ✅ + label). Para las de tipo `add_*`, botón "Deshacer" que borra el registro creado (delete por id vía TripContext). No persisten en `assistant_messages` (solo el texto, como hoy).

---

## Sesiones de implementación

| # | Sesión | Bloques | Estado |
|---|--------|---------|--------|
| 1 | Ruta editable + migración | F1–F4, migración `done` | ☐ Pendiente |
| 2 | Hoy en viaje | E1–E5 | ☐ Pendiente |
| 3 | Gastos y equipaje | G1–G4 | ☐ Pendiente |
| 4 | Chat pulido | I1–I2 | ☐ Pendiente |
| 5 | Fluidez (refactor) | D1–D3 | ☐ Pendiente |
| 6 | Shell y acceso | H1–H6 | ☐ Pendiente |

Orden pensado: la Sesión 5 (optimistic UI) es un refactor de TripContext — va DESPUÉS de las sesiones que tocan componentes para no pisarse; la 6 es independiente y puede hacerse en cualquier momento. No avanzar de sesión sin el QA de la anterior en verde.

### Sesión 1 — Prompt
> Lee SPEC-v4.md, Bloque F completo. Corre primero la migración de `activities.done` descrita al inicio del spec (créala como archivo de migración). Implementa F1 (modo edición de composer y modal de día con updateActivity/updateDay), F2 (reordenar con ↑↓, ojo con los unique constraints de position — usa posición temporal para el swap en Supabase), F3 (preview de categorías con el CategoryIcon compartido) y F4 (duration + fecha sugerida por position). Todo dual-mode.

**QA:** editar nombre y hora de un panorama existente; reordenar 3 panoramas y verificar que el orden persiste tras recargar; reordenar días; day-card colapsada muestra mini-iconos; crear día en viaje con startDate sugiere la fecha correcta.

### Sesión 2 — Prompt
> Lee SPEC-v4.md, Bloque E completo. Implementa el indicador de "ahora" y atenuado por hora (solo cuando el día mostrado es hoy, usando el timezone del viaje), el check de hecho con `toggleActivityDone` dual-mode sobre la columna `done` (migración ya corrida), el botón "cómo llegar" a Google Maps (coords > address > nada), las flechas de navegación entre días y el helper formatDate aplicado en Hoy, Ruta y TripsPage.

**QA:** con un día fechado hoy y actividades con horas pasadas/futuras, se ve el atenuado y la línea de ahora; marcar hecho tacha y actualiza el contador; "cómo llegar" abre Maps con las coords correctas; ← → navega y "volver a hoy" aparece.

### Sesión 3 — Prompt
> Lee SPEC-v4.md, Bloque G completo. Implementa el quick-add de gastos con defaults y "más opciones", settleUp en src/lib/settle.js (función pura greedy, con la lista de transferencias bajo cada balance-card), chips de categoría de gasto + filtro por pagador, y las plantillas de equipaje + botón "Generar con IA" (requiere agregar la tool add_packing_item a trip-assistant siguiendo el patrón de las write tools existentes y redesplegarla).

**QA:** registrar gasto con monto+nombre y un tap; con 3 miembros y gastos cruzados, las transferencias sugeridas cuadran con los netos; plantilla "Playa" llena la lista; "Generar con IA" produce ítems coherentes con el destino.

### Sesión 4 — Prompt
> Lee SPEC-v4.md, Bloque I completo. Implementa el mini-renderer de markdown (negritas, listas, links, saltos de línea; componentes React, sin dangerouslySetInnerHTML) y las tarjetas de acción: trip-assistant devuelve actions[] con los resúmenes de write tools ejecutadas (incluye el id del registro creado), AssistantChat las muestra como mini-cards con "Deshacer" para las add_*. Redesplegar la function.

**QA:** una respuesta con lista y negritas se renderiza bien; "agrega el Louvre al día 2" muestra la card ✅ y "Deshacer" lo elimina; nada de HTML inyectable (probar con `<script>` en un nombre).

### Sesión 5 — Prompt
> Lee SPEC-v4.md, Bloque D completo. Refactor delicado de TripContext: mutaciones optimistas (estado local primero, escritura remota detrás, refresh solo ante error) sin cambiar firmas públicas; toasts con acción en ToastContext (retrocompatible); todos los borrados pasan a optimistic + "Deshacer" y se elimina el confirm() de deleteDay; skeletons en cargas. Verifica especialmente que el realtime debounced no cause parpadeos al reconciliar.

**QA:** marcar equipaje con red lenta (throttle en devtools) se siente instantáneo; borrar un día y deshacer lo recupera con sus datos; borrar sin deshacer desaparece definitivo; con dos navegadores abiertos, los cambios del otro siguen llegando por realtime sin pisar los optimistas locales.

### Sesión 6 — Prompt
> Lee SPEC-v4.md, Bloque H completo. Implementa: manifest PWA + iconos + safe-area en la nav (H1); snapshot offline de solo lectura con banner (H2); cards de Mis viajes con countdown, estado y covers por hash + orden (H3); eliminar viaje con confirmación por nombre y avatares de miembros (H4); Edge Function accept-invite + ruta /join/:token + link copiable por invitación (H5); magic link y reset de contraseña en AuthPage, solo modo Supabase (H6).

**QA:** instalar en iPhone/Android y verificar que la nav no queda bajo la barra del sistema; modo avión → la app muestra el último viaje con banner; aceptar una invitación real con segunda cuenta vía /join/:token; eliminar viaje exige tipear el nombre; login con magic link funciona.

---

## Riesgos

- **Sesión 5 es el refactor riesgoso de v4** (TripContext optimista + interacción con realtime). Si se complica, partir: D2+D3 primero (independientes), D1 después en prompt aparte.
- **Swap de positions (F2)** contra los unique constraints: si Codex lo resuelve mal habrá errores 23505 intermitentes; el QA de reordenar + recargar lo detecta.
- **accept-invite (H5)** toca service role: revisar a mano que valide email del usuario contra la invitación y expiración antes de insertar; es la única superficie de seguridad nueva de v4.

## Checklist de cierre v4

- [ ] QA de las 6 sesiones en verde.
- [ ] Migración `done` aplicada; `trip-assistant` y `accept-invite` desplegadas.
- [ ] Lighthouse PWA: instalable; probar en teléfono real (safe-area, modo avión, magic link).
- [ ] Revisión final de regresiones: crear viaje → ruta → mapa → gastos → chat completo en modo local y Supabase.
