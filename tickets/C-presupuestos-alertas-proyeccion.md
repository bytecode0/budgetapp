# [Fase C] Presupuestos con alertas + Proyección de planes

**Tipo:** Epic / Feature (features #4 y #3 del plan)
**Esfuerzo:** S–M · **Riesgo:** Bajo
**Depende de:** categorías ya modeladas (existen) · cerrar fuente de verdad del progreso de planes
**Habilita:** mecanismo de alertas reutilizable por Fase F

## Contexto
El presupuesto por categoría/mes **ya existe**: `MonthlyBudget` (`prisma/schema.prisma:138`) y el endpoint `GET /api/monthly-budgets/review` (`server/routes/monthlyBudgets.ts:104`) ya cruzan `budgeted` vs `actual` y devuelven `diff`. Falta la capa de **alertas 80/100%**. Para planes, `GET /api/plans/monthly-status` (`server/routes/plans.ts:85`) ya da `contributed|missed|pending`; falta calcular la **aportación mensual necesaria** según `deadline` y avisar de **desviación**.

> ⚠️ Antes de empezar: resolver la deuda de doble conteo del progreso de planes. `LifePlan.currentAmount` se muta desde gastos (`expenses.ts:62`), desde `/contribute` (`plans.ts:188`) y coexiste con `PlanDeposit`. Definir la fuente de verdad para la proyección.

## Alcance
- **Presupuestos:** ampliar la respuesta de `review` con `pctUsed` y `alertLevel (ok|warn80|over100)` por categoría. Mostrar badges en `Home.tsx` (ya muestra over-budget global) y `MonthlyReview.tsx` / `AllocationFlow.tsx`.
- **Proyección de planes:** endpoint (nuevo `GET /api/plans/:id/projection` o ampliar `monthly-status`) que calcula `requiredMonthly = (targetAmount − current) / mesesHastaDeadline`, compara con ritmo real (media de `PlanDeposit`) y devuelve `onTrack|behind` + importe de desviación. Banner en `Home.tsx` reutilizando el patrón de "missed plan contributions" (`Home.tsx:170`).
- (Opcional) Entidad `Notification { userId, type, payload, month, readAt }` sólo si se quiere historificar/persistir.

## Archivos afectados
- `server/routes/monthlyBudgets.ts`, `server/routes/plans.ts`
- `src/app/components/Home.tsx`, `MonthlyReview.tsx`, `AllocationFlow.tsx`, `PlanDetail.tsx`, `PlanningDashboard.tsx`
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación
- [ ] `review` devuelve `pctUsed` y `alertLevel` por categoría; UI muestra aviso al 80% (amber) y 100% (red), coherente con la paleta del CLAUDE.md.
- [ ] Cada plan con `deadline` expone `requiredMonthly` y estado `onTrack|behind` con importe de desviación.
- [ ] Banner de desviación en Home cuando un plan va `behind`.
- [ ] El progreso del plan usa una única fuente de verdad documentada (sin doble conteo).
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance
- Alertas por email (Resend) / push — depende de decisión pendiente #4.
- Forecast/previsión (Fase D se ocupa de tendencia histórica, no de predicción).
