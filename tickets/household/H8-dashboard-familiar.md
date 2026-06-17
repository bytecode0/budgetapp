# [H8] Dashboard familiar

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **MVP**
**Esfuerzo:** M–L · **Riesgo:** Bajo
**Depende de:** H4, H5 (respeta visibilidad)

## Contexto
Panel que muestra la situación financiera del hogar como unidad, con vistas por categoría y por persona, respetando el nivel de privacidad (H5).

## Alcance (MVP)
- **Salud financiera**: ingresos totales, gastos totales, ahorro, **tasa de ahorro**, patrimonio neto (reutiliza net worth de Fase E).
- **Por categoría**: distribución, tendencias, comparación mensual (reutiliza analytics actual, agregado a nivel hogar).
- **Por persona**: ingresos, gastos, **contribución al hogar** (% de H4).
- **Objetivos**: estado/progreso (proyección completa con H7 en V2).
- **API**: `GET /api/dashboard/household?period=…`, `GET /api/dashboard/by-person?period=…` — ambos pasan por `visibilityFor` (H5).
- **UX**: tabs Hogar / Por persona / Categorías / Objetivos + switcher de contexto (Mi vista ↔ Vista hogar).

## Reglas
- RN-5 (cada endpoint respeta el `visibilityTier`): en `shared_stats`, "Por persona" muestra agregados, no transacciones.

## Archivos afectados
- `server/routes/dashboard.ts` (nuevo) o extensión de `analytics.ts`
- `src/app/components/` (dashboard familiar), hooks

## Criterios de aceptación
- [ ] KPIs de hogar correctos (ingresos/gastos/ahorro/tasa/patrimonio) agregando a los miembros.
- [ ] Vista "Por persona" muestra contribución al hogar según el modelo.
- [ ] El dashboard respeta el nivel de privacidad (sin fugas en `shared_stats`).

## Fuera de alcance
- Proyección/forecast de cashflow del hogar → V3.
- Comparativas avanzadas (benchmarks externos).
