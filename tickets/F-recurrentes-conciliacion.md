# [Fase F] Detección de recurrentes + Conciliación de duplicados

**Tipo:** Epic / Feature (features #2 y #5 del plan)
**Esfuerzo:** M–L · **Riesgo:** Medio
**Depende de:** Fase A (`merchant`), Fase B (categorización), Fase E (cuentas — para que dedupe aporte valor)
**Habilita:** importación bancaria (épico aparte)

## Contexto
- **Recurrentes (feature #2):** identificar suscripciones/recibos (mismo `merchant` + importe similar + cadencia mensual) y exponerlos como "compromisos fijos" asignables automáticamente en Asignaciones. Necesita `merchant` normalizado (Fase A) e histórico de varios meses.
- **Conciliación (feature #5):** detectar duplicados (mismo importe en ±2 días) y sugerir fusión. Pensado para cuando coexistan entrada manual e importación → de bajo valor hasta tener Fase E + importación.

## Alcance
- **Recurrentes:**
  - Entidad `RecurringCommitment { userId, merchant, avgAmount, cadence, allocationId?, nextExpectedDate, status (detected|confirmed|ignored) }`.
  - `server/lib/recurring.ts` (heurística de detección) + `server/routes/recurring.ts`.
  - UI en `AllocationFlow.tsx` para confirmar/ignorar y enlazar a una `Allocation` `fixed`.
- **Conciliación:**
  - `server/lib/dedupe.ts` + `GET /api/expenses/duplicates` (mismo importe, ventana ±2 días).
  - Vista de sugerencias de fusión en `Activity.tsx`.

## Archivos afectados
- `prisma/schema.prisma` (+ migración) — `RecurringCommitment`
- `server/lib/recurring.ts`, `server/routes/recurring.ts`, `server/lib/dedupe.ts` (nuevos), `server/routes/expenses.ts`, `server/index.ts`
- `src/app/components/AllocationFlow.tsx`, `Activity.tsx`
- `src/app/hooks/useRecurring.ts` (nuevo)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación
- [ ] Con histórico ≥3 meses, los comercios recurrentes se detectan con precisión razonable y son confirmables/ignorables.
- [ ] Un compromiso confirmado puede enlazarse a una asignación `fixed`.
- [ ] La conciliación detecta duplicados ±2 días/mismo importe y ofrece fusión sin pérdida de datos.
- [ ] Sensibilidad al `Float` mitigada (tolerancia de importe o céntimos de Fase A).
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance
- La importación bancaria en sí (CSV / API agregador open banking) — épico independiente que esta fase deja habilitado.
