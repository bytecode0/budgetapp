# [Fase B] Categorización automática + edición de gasto

**Tipo:** Epic / Feature (feature #1 del plan)
**Esfuerzo:** M · **Riesgo:** Bajo
**Depende de:** Fase A (`Expense.merchant`)
**Habilita:** mejor calidad de datos para Fase D (análisis) y Fase F (recurrentes)

## Contexto
"Categoría" en esta app **es** el modelo `Allocation` (no existe entidad Categoría separada). Categorizar = asignar `allocationId`. Falta (a) un motor de reglas descripción/comercio → asignación y (b) UI para reasignar un gasto, que hoy no existe: `Activity.tsx` sólo permite borrar, aunque `useExpenses.updateExpense` ya está implementado (`src/app/hooks/useExpenses.ts:61`).

## Alcance
- **Sub-tarea 1 — UI de edición/reasignación de gasto** (prerrequisito del aprendizaje):
  - Permitir cambiar `allocationId`/importe/nota de un gasto desde `Activity.tsx`.
- **Sub-tarea 2 — Motor de reglas:**
  - Entidad `CategorizationRule { userId, matchType (contains|equals|regex), pattern, allocationId, priority, source (manual|learned), createdAt }`.
  - `server/lib/categorize.ts`: dado `merchant`/`description`, devuelve `allocationId` por regla de mayor `priority`.
  - En `POST /api/expenses`, si no llega `allocationId`, aplicar reglas.
  - `server/routes/rules.ts`: CRUD de reglas (sigue convención `{ data }`/`{ error }`, batch antes de `/:id`).
- **Sub-tarea 3 — Aprendizaje por corrección:**
  - Al reasignar manualmente un gasto, crear/actualizar una regla `source='learned'` sobre su `merchant`.

## Archivos afectados
- `prisma/schema.prisma` (+ migración) — `CategorizationRule`
- `server/routes/expenses.ts`, `server/routes/rules.ts` (nuevo), `server/lib/categorize.ts` (nuevo)
- `src/app/components/Activity.tsx`, `src/app/components/AddExpense.tsx` (sugerencia de categoría)
- `src/app/hooks/useRules.ts` (nuevo)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación
- [ ] Crear un gasto sin categoría con `merchant` que matchea una regla lo asigna automáticamente.
- [ ] Reasignar un gasto manualmente genera/actualiza una regla `learned` para ese comercio.
- [ ] Conflictos de reglas resueltos de forma determinista por `priority`.
- [ ] El usuario puede ver/editar/borrar sus reglas.
- [ ] Strings nuevos en `en.json` y `es.json`.

## Fuera de alcance
- Sugerencias por ML / categorización semántica.
- Detección de recurrentes (Fase F).
