# [Fase D] Análisis temporal en dashboard

**Tipo:** Epic / Feature (feature #6 del plan)
**Esfuerzo:** M · **Riesgo:** Bajo
**Depende de:** —  (gana mucho valor tras Fase B: categorización consistente)
**Habilita:** —

## Contexto
Los datos para análisis ya existen (`Expense.date`, `MonthlyBudget`, `PlanDeposit`) y `recharts` ya está instalado. El dashboard actual (`Home.tsx`) sólo muestra el mes seleccionado; el "85% aligned" del sidebar (`App.tsx:300`) es un valor **hardcodeado** a sustituir por dato real.

## Alcance
- Endpoint de agregación multi-mes: `GET /api/analytics?from=YYYY-MM&to=YYYY-MM` con:
  - gasto total por mes (comparativa mes a mes),
  - gasto medio por categoría (`allocationId`),
  - tendencia de ahorro (derivada de `PlanDeposit` / saldo).
- Visualizaciones con `recharts` en `Home.tsx` o nueva sección.
- Sustituir el indicador hardcodeado del sidebar por el dato calculado.

## Archivos afectados
- `server/routes/analytics.ts` (nuevo) + montaje en `server/index.ts`
- `src/app/components/Home.tsx` (o nuevo componente de análisis)
- `src/app/App.tsx` (sidebar: reemplazar mock)
- `src/app/hooks/useAnalytics.ts` (nuevo)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación
- [ ] Serie mes a mes correcta en el rango pedido (respetando el rango permitido por `MonthContext`).
- [ ] Media de gasto por categoría calculada sobre datos categorizados.
- [ ] Tendencia de ahorro visible y coherente con `PlanDeposit`.
- [ ] El indicador del sidebar deja de ser un valor fijo.
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance
- Previsión/forecast.
- Exportación de informes.
