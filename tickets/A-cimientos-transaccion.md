# [Fase A] Cimientos del dato de transacción

**Tipo:** Epic / Refactor de modelo
**Esfuerzo:** M · **Riesgo:** Bajo-Medio
**Depende de:** —
**Habilita:** Fase B (categorización), Fase F (recurrentes/dedupe), futura importación

## Contexto
Hoy `Expense` (`prisma/schema.prisma:105`) sólo tiene `amount`, `description`, `date`, `allocationId`. No hay comercio normalizado ni origen de la transacción. Varias features futuras (categorización, recurrentes, conciliación, importación) necesitan estos campos. Se hace **una sola migración** para no repetir refactors del modelo central de gastos.

## Alcance
- Añadir a `Expense`:
  - `merchant: String` — comercio normalizado, derivado de `description` al crear/editar.
  - `source: String` — `manual | import` (default `manual`).
  - `externalId: String?` — idempotencia para futura importación.
- Helper de normalización `server/lib/normalizeMerchant.ts` (p.ej. "Mercadona SA 1234" → `mercadona`).
- Aplicar normalización en `POST/PATCH /api/expenses` (`server/routes/expenses.ts:40,77`).
- Backfill: poblar `merchant` y `source='manual'` en gastos existentes (migración de datos).
- **Decisión transversal a cerrar aquí:** ¿`amount` pasa de `Float` a `Int` (céntimos) / `Decimal`? Si sí, incluirlo en esta migración (lo piden features 4 y 5).

## Archivos afectados
- `prisma/schema.prisma`, nueva migración en `prisma/migrations/`
- `server/routes/expenses.ts`
- `server/lib/normalizeMerchant.ts` (nuevo)
- `src/app/hooks/useExpenses.ts` (tipos `Expense`)

## Criterios de aceptación
- [ ] Todo gasto nuevo y existente tiene `merchant` normalizado y `source='manual'`.
- [ ] La normalización tiene tests (MERCADONA, "Mercadona SA 1234", minúsculas/acentos → mismo `merchant`).
- [ ] Alta y edición de gasto siguen funcionando igual (regresión cero en UX).
- [ ] Si se aborda céntimos: todos los importes migrados sin pérdida de precisión y la UI muestra los mismos valores.

## Fuera de alcance
- Motor de reglas de categorización (Fase B).
- Detección de recurrentes / duplicados (Fase F).
- Importación CSV/open banking.
