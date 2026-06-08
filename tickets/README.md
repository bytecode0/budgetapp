# Roadmap de evolución — LifePlan BudgetApp

Tickets por fase (un epic por fase). Orden de implementación recomendado A → F.

| Fase | Ticket | Features del plan | Esfuerzo | Depende de |
|---|---|---|---|---|
| A | [Cimientos del dato de transacción](./A-cimientos-transaccion.md) | base para 1/2/5 + import | M | — |
| B | [Categorización automática + edición de gasto](./B-categorizacion-automatica.md) | #1 | M | A |
| C | [Presupuestos con alertas + Proyección de planes](./C-presupuestos-alertas-proyeccion.md) | #4, #3 | S–M | categorías (existen) |
| D | [Análisis temporal en dashboard](./D-analisis-temporal.md) | #6 | M | — (mejor tras B) |
| E | [Multi-cuenta y patrimonio neto](./E-multicuenta-patrimonio.md) | #7 | L | — |
| E2 | [Ingresos transaccionales (tabla Income)](./E2-ingresos-transaccionales.md) | ingreso como movimiento | M | E (A, B recomendado) |
| F | [Recurrentes + Conciliación de duplicados](./F-recurrentes-conciliacion.md) | #2, #5 | M–L | A, B, E |
| G | [Importación de extractos (XLSX/CSV), BBVA](./G-importacion-extractos.md) | importación (CSV→banco) | M–L | A (duro); recomendado: E, B, F |
| H | [Open banking / agregador](./H-open-banking.md) (placeholder) | importación (API) | L | G, E |

## Por qué este orden
- **A primero:** una sola migración de `Expense` (`merchant`, `source`, `externalId`, opcional céntimos) que sirve a B, F y a la futura importación → evita migraciones parciales repetidas.
- **B antes que D y F:** categorización consistente alimenta el análisis y la detección de recurrentes.
- **C pronto:** alto valor/bajo coste; presupuestos ya están a medio construir (`MonthlyBudget` + endpoint `review`).
- **E antes que la conciliación:** la feature #5 no aporta valor sin importación; E deja el modelo listo para ella.
- **E2 (ingresos) justo tras E:** el ingreso pasa de número estático (`UserSettings.monthlyIncome`) a movimiento transaccional (tabla `Income` paralela a `Expense`), necesario para que la importación registre abonos y para el cashflow real. Depende de `Account` (E) y reutiliza los patrones de A/B. Decisión cerrada: tabla paralela, no `Transaction` unificada (ver ticket).
- **G (importación) tras E, B y F:** ver el ticket; solo A es bloqueante duro, pero E (cuenta de origen, evita backfill de `accountId`), B (auto-categorizar el volumen importado) y F (dedupe/idempotencia) elevan mucho el valor antes de G. C y D son independientes y pueden ir después.

## Decisiones pendientes (bloquean partes del plan)
1. **Multi-usuario / hogar:** ¿las features operan por usuario o combinando pareja (`UserSettings.linkedUserId`)? — afecta A, C, D, E. **Dirección elegida:** pool compartido por el usuario primario (ya implementado en `auth.ts`) + atribución por persona vía `ownerUserId` (= `req.authUserId`) en `Account`/`Income`/`Expense`, sin entidad "hogar" separada.
7. **Transferencias entre cuentas:** un traspaso es un cargo + un abono que no deben contar como gasto ni ingreso. ¿Se modela con `transferGroupId` que enlaza ambos movimientos y los excluye de los cálculos? — surge con E2/E.
2. **Fuente de verdad del progreso de planes:** `currentAmount` vs `PlanDeposit` (riesgo de doble conteo) — bloquea C.
3. **`Float` → céntimos/`Decimal`:** ¿se aborda en A? — lo piden #4 y #5.
4. **Notificaciones:** ¿alertas sólo in-app o también email (Resend)/push? — define entidad `Notification` y jobs.
5. **Importación bancaria:** BBVA exporta **`.xlsx`** → ticket **G** (CSV/XLSX) primero, open banking (**H**) después. Decidir librería de lectura (SheetJS vs exceljs) y estrategia de `externalId` derivado.
6. **Divisa:** ¿multi-divisa por cuenta o todo EUR? — afecta E y UI (hoy `€` hardcodeado).
