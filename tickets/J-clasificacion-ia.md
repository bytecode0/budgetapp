# [Fase J] Clasificación y configuración de categorías asistida por IA

**Tipo:** Epic / Feature (nueva — resuelve el arranque en frío que las reglas no pueden)
**Esfuerzo:** M–L · **Riesgo:** Medio (dependencia externa, coste, latencia, privacidad)
**Depende de (duro):** Fase B (reglas/allocations) y Fase G (import) — ✅; Fase I (sugerencia/aprendizaje/lote) — ✅ implementada (deja el flujo determinista sólido y el aprendizaje en el `confirm`)
**Habilita:** la experiencia "importa el Excel y pulsa un botón"

## Contexto

Las reglas (Fase B) son deterministas, gratuitas y auditables, pero **no resuelven el arranque en frío**: un usuario nuevo no tiene reglas ni casi categorías (`server/lib/defaults.ts` siembra solo 2 allocations: "Fixed Expenses" y "Flexible Spending"). La IA encaja exactamente aquí —clasificar lo desconocido la primera vez— **sin reemplazar las reglas**, que siguen cubriendo el volumen recurrente sin coste.

Hoy **no hay ningún SDK de IA instalado** (`package.json` sin `@anthropic-ai/sdk`), así que esto introduce una dependencia nueva, una API key (variable de entorno) y manejo de errores/timeout/coste.

## Decisiones de diseño

- **IA como *fallback*, no como motor principal.** Orden de precedencia al categorizar:
  `regla equals/contains` → `regla learned` → `IA (solo comercios sin regla)` → `unassigned`.
  Así las reglas (gratis, deterministas) hacen el grueso y la IA solo trabaja sobre lo nuevo.
- **Opt-in y bajo demanda, no automática en cada preview.** Se dispara con un botón ("Clasificar con IA") en el preview. Controla coste y cumple el "importar y pulsar un botón".
- **Batch por comercio, no por transacción.** Enviar los `merchant` distintos sin regla (≈15-20 por extracto, no los ~100 movimientos) en **una sola llamada**, junto con la lista de allocations del usuario, y recibir `{ merchant → allocationId }`. Coste ≈ una llamada por import. Cap de comercios por llamada (40) como control de coste/tamaño.
- **Cada acierto de IA se materializa como regla `learned` — gratis vía Fase I.** El `POST /import/confirm` de la Fase I ya ejecuta `learnFromCorrection` por cada fila con `allocationId`; por tanto, al confirmar las sugerencias de IA se crean reglas automáticamente → el siguiente extracto no vuelve a llamar a la IA para esos comercios. **No hay trabajo nuevo de backend aquí.**
- **Modelo:** **Haiku 4.5** (`claude-haiku-4-5`) por defecto — barato ($1/$5 por 1M) y de sobra para clasificación; configurable vía `AI_MODEL`. **Salida estructurada (`output_config.format`, JSON Schema)** para devolver `allocationId` válidos, no texto libre. Sin `thinking`/`effort` (no soportados en Haiku).
- **No inventa categorías al clasificar.** Se le pasa la lista de allocations (id+nombre); la salida se **valida contra esos ids** y cualquier id desconocido → `null`. La creación de categorías es un flujo aparte y explícito.
- **Flag de disponibilidad:** `GET /api/ai/status` → `{ enabled }` derivado de `!!process.env.ANTHROPIC_API_KEY`; el frontend oculta los botones de IA si no está configurada.
- **El usuario manda:** las sugerencias de IA se muestran en el preview (marcadas como "IA") y son editables antes de confirmar — reutiliza el panel "Asignar por comercio" de la Fase I como superficie de revisión.
- **Auto-configuración de categorías (opt-in):** si el usuario tiene el set por defecto, la IA puede **proponer** un conjunto de allocations a partir de los comercios reales del fichero (p. ej. Mercadona/Carrefour → "Supermercado"; Repsol/Cepsa → "Combustible"). Se proponen, no se crean a ciegas; el usuario confirma.
- **Privacidad y fallback:** se envían descripciones/comercios de movimientos a un tercero → documentarlo y hacerlo **opt-in**. Si la API falla o agota timeout, el import **no se bloquea**: las filas quedan `unassigned` (comportamiento actual) y se avisa.

## Alcance

- **Sub-tarea 0 — Dependencia y configuración:**
  - `npm install @anthropic-ai/sdk`. `.env`: `ANTHROPIC_API_KEY` (+ opcional `AI_MODEL`). Documentar en README (opcional).
  - `GET /api/ai/status` → `{ enabled }` para que el frontend muestre/oculte los botones de IA.
- **Sub-tarea 1 — Servicio de IA (`server/lib/ai/classify.ts`, nuevo):**
  - `classifyMerchants(merchants[], allocations[])` → `{ merchant → allocationId | null }` vía Claude con `output_config.format`. Cliente lazy (null si no hay key), `timeout` ~20s, validación contra ids permitidos, degradación a `null`. `aiEnabled()` helper.
- **Sub-tarea 2 — Endpoint de clasificación (`server/routes/expenses.ts`):**
  - `POST /api/expenses/import/classify` Body `{ merchants[] }` (sub-ruta **antes** de `/:id`): 503 si deshabilitado, dedup + cap 40, carga allocations del usuario, devuelve `{ suggestions: [{ merchant, allocationId, name }] }`. No escribe nada.
- **Sub-tarea 3 — Materialización:** sin trabajo nuevo (la Fase I ya aprende en `import/confirm`). Solo documentar.
- **Sub-tarea 4 — Auto-configuración de categorías (opt-in):**
  - `server/lib/ai/suggestCategories.ts` (nuevo) + `POST /api/expenses/import/suggest-categories` Body `{ merchants[] }` → `{ categories: [{ name, icon, merchants[] }] }` (cap ≤ 12, nombres saneados). UI de revisión; crear vía `POST /api/allocations` existente; luego re-clasificar.
- **Sub-tarea 5 — UX "un botón" (`ImportStatement.tsx` + `useImport.ts`):**
  - Botón "Clasificar con IA" cuando hay comercios sin clasificar y la IA está habilitada; reutiliza `merchantGroups` (Fase I), fusiona en `allocByRow`, badge "IA", loader, toast de error (no bloquea).
  - Si solo hay categorías por defecto → ofrecer primero "Configurar categorías con IA".
- Strings en `en.json` / `es.json`.

## Archivos afectados

- `package.json` (`@anthropic-ai/sdk`), `.env` / README (API key, `AI_MODEL`)
- `server/lib/ai/classify.ts` (nuevo), `server/lib/ai/suggestCategories.ts` (nuevo)
- `server/routes/expenses.ts` (`import/classify`, `import/suggest-categories`), `server/routes/ai.ts` (nuevo, `/ai/status`) + montaje en `server/index.ts`
- `server/lib/categorize.ts` / `learnFromCorrection` (reutilizado — ya integrado por la Fase I)
- `src/app/components/ImportStatement.tsx` (botones IA, badge, revisión de categorías), `src/app/hooks/useImport.ts` (`classify`, `suggestCategories`, `aiEnabled`)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación

- [ ] En un extracto sin reglas previas, "Clasificar con IA" rellena sugerencias para los comercios reconocibles; el usuario puede editarlas antes de confirmar.
- [ ] La IA **solo** se invoca para comercios sin regla (verificable: con reglas que cubren todo, no hay llamada a IA).
- [ ] Las sugerencias de IA aceptadas quedan como reglas `learned` y no se vuelven a consultar a la IA en el siguiente import.
- [ ] Si la API falla/timeout, el import continúa y las filas quedan `unassigned` con aviso (sin romper el flujo).
- [ ] La auto-configuración de categorías propone, nunca crea allocations sin confirmación del usuario.
- [ ] Salida de IA validada contra `allocationId` reales del usuario (no inventa categorías).
- [ ] Función opt-in y documentada (se envían datos a un tercero). Sin `ANTHROPIC_API_KEY`, `GET /api/ai/status` devuelve `{ enabled: false }` y el frontend oculta los botones de IA.
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance

- Reentrenamiento / fine-tuning de modelos propios.
- Clasificación en tiempo real de cada gasto manual vía IA (el alta manual usa reglas/sugerencia de la Fase I; la IA es para el volumen del import).
- Multi-divisa y normalización de moneda (decisión pendiente #6).
