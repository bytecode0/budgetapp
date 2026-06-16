# [H7] Objetivos familiares

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **V2**
**Esfuerzo:** M · **Riesgo:** Bajo
**Depende de:** H1, H4 · Reutiliza `LifePlan`/`PlanDeposit`

## Contexto
Objetivos compartidos del hogar (fondo de emergencia, vacaciones, vivienda, jubilación, educación, custom) con aportación recomendada por miembro y proyección. Extiende `LifePlan`, que hoy cuelga del pool sin atribución por persona.

## Alcance (V2)
- **Modelo**: `LifePlan + householdId?`; `GoalContribution { lifePlanId, userId, amount, month, source }`.
- **Cálculos**:
  - Progreso actual = Σ contribuciones / meta.
  - Fecha estimada = `actual + ritmo_aportación`.
  - Aportación recomendada por miembro = `(meta − actual)/meses_restantes` repartida por el modelo de H4.
- **API**: `POST /api/plans/:id/contributions`, `GET /api/plans/:id/projection`.
- **UX**: crear objetivo (tipo + meta + fecha) → aportación recomendada por miembro → seguimiento con proyección.

## Reglas
- RN-7 (aportación recomendada y fecha estimada).

## Archivos afectados
- `prisma/schema.prisma` (+ migración), `server/routes/plans.ts`, `server/lib/` (proyección)
- `src/app/components/` (objetivos familiares)

## Criterios de aceptación
- [ ] Un objetivo de hogar muestra progreso, fecha estimada y aportación recomendada por miembro (según modelo).
- [ ] Registrar contribuciones por miembro actualiza progreso y proyección.

## Fuera de alcance
- "What-if" / escenarios de objetivos y priorización entre metas → V3.
