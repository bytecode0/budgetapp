# [Fase K] Presupuestos sugeridos a partir del historial (post-importación)

**Tipo:** Epic / Feature (nueva — cierra el ciclo de la importación: categorías + clasificación + presupuesto)
**Esfuerzo:** M · **Riesgo:** Bajo (sin migraciones, sin dependencia de IA)
**Depende de (duro):** Fase B (allocations) y Fase G (import) — ✅; **recomendado tras Fase J** (las categorías sugeridas por IA quedan en €0 y esta fase las completa)
**Habilita:** que un usuario importe, clasifique y tenga presupuestos realistas sin teclear ningún importe

## Contexto

Tras la Fase J, un usuario importa, la IA sugiere categorías y clasifica los gastos — pero los `allocatedAmount` de esas categorías quedan en **€0**, así que el Budget Review las muestra "sin presupuesto" y el seguimiento es pobre. Falta el último paso: **sugerir un monto por categoría**.

**Decisión de diseño central:** el monto **no lo genera la IA**, se **calcula del historial**. Un LLM no es fiable sumando transacciones y sería coste innecesario; la IA ya cumplió su papel (clasificar texto → `allocationId`). Una vez clasificado el historial, el presupuesto sugerido es un cálculo determinista (mediana del gasto mensual por categoría). Gratis, exacto, auditable, y funciona sin `ANTHROPIC_API_KEY`.

## Decisiones de diseño

- **Estadístico:** **mediana** de los totales por mes de cada categoría sobre los **últimos 6 meses completos** (excluye el mes actual parcial). Resiste picos (seguros anuales, compras grandes). Redondeo a múltiplos de €5.
- **Confianza:** <2 meses de datos → "baja confianza" (usa el único mes observado). Sin historial → sin sugerencia.
- **Dónde vive el monto:** `Allocation.allocatedAmount` (presupuesto base recurrente). El review ya lo usa vía `budgetMap[id] ?? a.allocatedAmount`. Escribir `MonthlyBudget` por mes queda fuera del MVP.
- **Alcance al aplicar:** por defecto rellena **solo las categorías en €0** (no pisa presupuestos ya configurados). Para las que ya tienen monto, muestra "actual vs sugerido" informativo; el usuario decide caso a caso.
- **Excluir `plan`** (metas de ahorro): se presupuestan distinto.
- **Guardarraíl de ingresos:** mostrar Σ sugerido vs ingreso mensual medio; avisar si supera el ingreso.
- **Timing:** los montos requieren historial **persistido** → se calculan **tras confirmar el import** (no en el preview). Usa todo el historial en BD (incluye imports previos), más exacto.

## Alcance

- **Sub-tarea 1 — Servicio de cálculo** (`server/lib/suggestBudgets.ts`, nuevo, sin IA):
  - Agrupa gastos por `allocationId` × mes (últimos 6 completos), calcula la mediana de los totales mensuales, redondea a €5, marca `confidence` por nº de meses. Excluye el mes actual y las allocations `plan`. Devuelve `[{ allocationId, suggested, monthsObserved, confidence }]`.
- **Sub-tarea 2 — Endpoints** (`server/routes/allocations.ts`):
  - `GET /api/allocations/suggested-budgets?months=6` → sugerencias + `name`/`icon` + `allocatedAmount` actual (para "actual vs sugerido").
  - `PATCH /api/allocations/budgets` (batch, **antes** de `/:id`) Body `{ budgets: [{ id, allocatedAmount }] }` → update transaccional (valida pertenencia al usuario).
- **Sub-tarea 3 — UX post-importación** (`ImportStatement.tsx`):
  - Tras confirmar, paso/aviso "Sugerir presupuestos" → panel por categoría (icono, nombre, **actual vs sugerido**, badge de confianza), checkboxes (por defecto marcadas las que están en €0), total vs ingreso. "Aplicar presupuestos" → `PATCH /budgets`.
- **Sub-tarea 4 — UX en el módulo de presupuesto** (`AllocationFlow.tsx`):
  - Botón "Sugerir desde mi historial" que rellena los `allocatedAmount` en €0 (con revisión). Reutiliza endpoint/panel.
- `src/app/hooks/useAllocations.ts`: método batch para `PATCH /budgets` + refetch.
- Strings en `en.json` / `es.json`.

## Archivos afectados

- `server/lib/suggestBudgets.ts` (nuevo), `server/routes/allocations.ts`
- `src/app/components/ImportStatement.tsx`, `src/app/components/AllocationFlow.tsx`, `src/app/hooks/useAllocations.ts`
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación

- [ ] Para una categoría con ≥2 meses de gasto, la sugerencia ≈ mediana mensual redondeada a €5.
- [ ] El mes actual (parcial) se excluye del cálculo.
- [ ] Aplicar sugerencias fija `allocatedAmount` y se refleja en el Budget Review.
- [ ] Por defecto solo rellena categorías en €0; las no-nulas se muestran como "actual vs sugerido" y no se tocan sin confirmación. Categorías `plan` excluidas.
- [ ] Aviso si Σ presupuestos > ingreso mensual medio.
- [ ] **El monto no pasa por la IA** (cálculo determinista; funciona sin `ANTHROPIC_API_KEY`).
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance

- Snapshots `MonthlyBudget` por mes (solo presupuesto base recurrente).
- Escalado automático al ingreso / reglas tipo 50-30-20.
- Proyección/forecast de gasto a futuro.
- Sugerencia de montos vía LLM (descartado por diseño: el cálculo determinista es más fiable y gratis).
