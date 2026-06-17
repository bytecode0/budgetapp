# [H3] Atribución de transacciones (pagador / beneficiario / reparto)

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **MVP** (concepto crítico)
**Esfuerzo:** M–L · **Riesgo:** Medio
**Depende de:** H1, H2 · **Habilita:** H4, H6, H8

## Contexto
El concepto crítico de la épica: separar **quién paga**, **quién se beneficia** y **cómo se reparte** un gasto. Hoy `Expense` ni siquiera tiene pagador. La propiedad del gasto NO debe depender de quién subió el extracto. Decisión cerrada: se mantiene `Expense`/`Income` separadas; la atribución se añade a `Expense`.

## Alcance (MVP)
- **Modelo** (`Expense`): `+ payerUserId`, `+ scope` ('personal' | 'shared'), `+ beneficiaryUserId?`, `+ scopeConfidence?`, `+ scopeSource` ('manual' | 'ai' | 'rule').
- **Modelo** `ExpenseShare { expenseId, userId, amount }` — la distribución; `Σ shares == expense.amount` (residuo de redondeo al pagador).
- **Generación de shares**: según el `financialModel` del hogar (H4), con override puntual.
- **API**: `POST /api/expenses` (+ payer/scope/beneficiary/shares), `PATCH /api/expenses/:id/attribution`.
- **UX**: editor de reparto (sheet): Pagador · Scope · Distribución (Según modelo / 50-50 / Custom con sliders).
- **Import**: columna "scope + reparto" en el preview (hereda modelo; editable).
- **Backfill**: `payerUserId = account.ownerUserId ?? userId`, `scope='shared'`, shares equal por defecto.

## Reglas
- RN-1 (Σ shares == importe), RN-3 (atribución ≠ quién importó), RN-4 (solo `shared` genera balances).

## Archivos afectados
- `prisma/schema.prisma` (+ migración), `server/routes/expenses.ts`, `server/lib/contributions.ts` (H4)
- `src/app/components/ImportStatement.tsx`, editor de gasto, `useExpenses`/`useImport`

## Criterios de aceptación
- [ ] Un gasto registra pagador, scope y reparto independientes.
- [ ] Reasignar scope/reparto a mano recalcula `ExpenseShare` y cuadra al céntimo.
- [ ] El preview de import permite ajustar scope+reparto por fila.

## Fuera de alcance
- Atribución de ingresos compartidos (los ingresos ya tienen `ownerUserId`).
- Reparto por ítem dentro de un mismo ticket → V3.
