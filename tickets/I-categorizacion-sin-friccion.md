# [Fase I] Categorización sin fricción (sugerencia en vivo, aprendizaje en import, asignación en lote)

**Tipo:** Feature (mejora de UX sobre B + G ya implementadas)
**Esfuerzo:** S–M · **Riesgo:** Bajo
**Depende de (duro):** Fase B (`CategorizationRule`, `categorize`, `learnFromCorrection`) y Fase G (import preview/confirm) — ✅ ambas implementadas
**Habilita:** Fase J (IA) — deja el flujo determinista sólido para que la IA solo cubra el arranque en frío

## Contexto

La Fase B construyó un motor de reglas correcto (`server/lib/categorize.ts`) y la Fase G lo invoca en el preview del import (`server/lib/importStatement.ts:94`). Pero en la práctica **la primera importación no clasifica nada**: las reglas solo nacen (a) a mano en `RulesManager` o (b) "aprendidas" al editar un gasto ya existente (`server/routes/expenses.ts:334`). Un usuario nuevo tiene **cero reglas** → `categorize()` devuelve `null` para todos los movimientos del primer extracto. Esto obliga a clasificar gasto por gasto, anulando la ventaja de importar.

> **Aclaración importante (no es objetivo de este ticket):** los gastos importados **ya se registran y ya suman en el total del mes** aunque estén sin categoría. `monthlyBudgets.ts:125-163` suma todas las filas del rango (los `allocationId = null` se agrupan como `__unassigned__` e **se incluyen** en `totalActual`); analytics hace lo mismo. Lo que falta sin categoría es el **desglose por categoría** y el presupuesto vs. real por allocation. Este ticket reduce la fricción de *categorizar*, no arregla el total (que ya funciona).

Tres problemas concretos a resolver:
1. El alta manual (`AddExpense.tsx`) no propone categoría al escribir la descripción; la regla solo se aplica en el backend al guardar y solo si dejas "Unassigned".
2. El preview del import no aprende: los overrides de categoría que el usuario hace fila a fila **no** disparan `learnFromCorrection` (solo lo hace el `PATCH /:id`), así que ni corrigiendo en el preview enseñas al sistema.
3. No hay asignación en lote: hay que tocar el `<select>` de cada fila, aunque un extracto de ~100 movimientos suele tener solo ~15-20 comercios distintos (`merchant` ya viene normalizado).

## Decisiones de diseño

- **Sugerencia en vivo, no auto-guardado:** la categoría sugerida se **preselecciona** pero el usuario manda. Mantiene el patrón actual de elección explícita de `AddExpense`.
- **Endpoint de sugerencia ligero:** `GET /api/expenses/suggest?description=...` reutiliza `categorize()` sin crear nada. Debounce en cliente (~300 ms).
- **Aprender en el confirm del import:** para cada fila confirmada con `allocationId`, llamar a `learnFromCorrection(userId, merchant, allocationId)`. Así el primer extracto, al clasificar "Mercadona" una vez, crea la regla y el resto del fichero / próximos imports ya se autoclasifican.
- **Agrupar el preview por `merchant`:** la UI agrupa filas por comercio normalizado; asignar al grupo propaga a todas sus filas. No cambia el contrato de `import/confirm` (sigue recibiendo filas individuales).

## Alcance

- **Sub-tarea 1 — Sugerencia en vivo en alta manual:**
  - `GET /api/expenses/suggest` (sub-ruta antes de `/:id`) → `{ data: { allocationId, name } | null }`.
  - `AddExpense.tsx`: al teclear la descripción (debounced), preseleccionar la allocation sugerida; el usuario puede cambiarla.
  - Reutilizar en `EditExpense.tsx` si aplica.
- **Sub-tarea 2 — Aprendizaje en import:**
  - En `POST /api/expenses/import/confirm` (`server/routes/expenses.ts:217`), tras crear las filas, ejecutar `learnFromCorrection` por cada fila con categoría (dedupe por `merchant` para no repetir upserts).
- **Sub-tarea 3 — Asignación en lote en el preview:**
  - `ImportStatement.tsx`: agrupar filas nuevas por `merchant`; un selector por grupo asigna la categoría a todas sus filas (manteniendo override individual).
  - Mostrar contador "N comercios sin clasificar" para guiar al usuario.
- Strings nuevos en `en.json` / `es.json`.

## Archivos afectados

- `server/routes/expenses.ts` (nueva sub-ruta `suggest`; aprendizaje en `import/confirm`)
- `server/lib/categorize.ts` (reutilizado; sin cambios de lógica esperados)
- `src/app/components/AddExpense.tsx`, `src/app/components/EditExpense.tsx`
- `src/app/components/ImportStatement.tsx` (agrupación + lote)
- `src/app/hooks/useExpenses.ts` / `useImport.ts` (llamada a suggest / sin cambio de contrato en confirm)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación

- [ ] Al escribir una descripción que matchea una regla en el alta manual, la categoría aparece preseleccionada y editable.
- [ ] Confirmar un import asignando un comercio crea/actualiza una regla `learned`; un segundo import de ese comercio llega ya sugerido.
- [ ] En el preview, asignar categoría a un comercio la propaga a todas sus filas; el override por fila sigue disponible.
- [ ] El total del mes y la lista de Activity no cambian de comportamiento (los sin asignar ya cuentan — regresión a vigilar).
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance

- Clasificación semántica / IA para comercios sin regla → **Fase J**.
- Auto-creación de categorías → **Fase J**.
- Cambios en cómo se calcula el total del mes (ya incluye los sin asignar).
