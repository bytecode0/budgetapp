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
| I | [Categorización sin fricción (sugerencia en vivo, aprendizaje en import, lote)](./I-categorizacion-sin-friccion.md) | reduce fricción de categorizar tras importar | S–M | B, G (duro) |
| J | [Clasificación y configuración de categorías por IA](./J-clasificacion-ia.md) | "importa y pulsa un botón" | M–L | B, G (duro); recomendado tras I |
| K | [Presupuestos sugeridos a partir del historial](./K-presupuestos-sugeridos.md) | monto por categoría calculado del historial (sin IA) | M | B, G (duro); recomendado tras J |

## Por qué este orden
- **A primero:** una sola migración de `Expense` (`merchant`, `source`, `externalId`, opcional céntimos) que sirve a B, F y a la futura importación → evita migraciones parciales repetidas.
- **B antes que D y F:** categorización consistente alimenta el análisis y la detección de recurrentes.
- **C pronto:** alto valor/bajo coste; presupuestos ya están a medio construir (`MonthlyBudget` + endpoint `review`).
- **E antes que la conciliación:** la feature #5 no aporta valor sin importación; E deja el modelo listo para ella.
- **E2 (ingresos) justo tras E:** el ingreso pasa de número estático (`UserSettings.monthlyIncome`) a movimiento transaccional (tabla `Income` paralela a `Expense`), necesario para que la importación registre abonos y para el cashflow real. Depende de `Account` (E) y reutiliza los patrones de A/B. Decisión cerrada: tabla paralela, no `Transaction` unificada (ver ticket).
- **G (importación) tras E, B y F:** ver el ticket; solo A es bloqueante duro, pero E (cuenta de origen, evita backfill de `accountId`), B (auto-categorizar el volumen importado) y F (dedupe/idempotencia) elevan mucho el valor antes de G. C y D son independientes y pueden ir después.
- **I (fricción) tras G:** B + G ya funcionan, pero el primer import no clasifica nada (arranque en frío: no hay reglas todavía) y obliga a categorizar gasto por gasto. I añade sugerencia en vivo al escribir, aprendizaje en el confirm del import y asignación en lote por comercio — todo determinista, sin IA. **Nota:** los gastos importados ya cuentan en el total del mes aunque estén sin categoría (`monthlyBudgets.ts` suma los `__unassigned__`); I es para el desglose por categoría, no para el total.
- **K (presupuestos) tras J:** cierra el ciclo de la importación. Tras J las categorías sugeridas quedan en €0; K calcula el monto por categoría desde el historial ya clasificado (mediana de 6 meses) y lo aplica — **determinista, sin IA** (un LLM no es fiable sumando transacciones). Rellena por defecto solo las categorías en €0.
- **J (IA) tras I:** la IA solo aporta donde las reglas no pueden — el arranque en frío. Se usa como *fallback* (regla → learned → IA → unassigned), en batch por comercio, y cada acierto se materializa como regla `learned` para que la factura de IA decrezca. Habilita el "importa y pulsa un botón". Conviene hacer I antes para que el flujo determinista esté sólido y la IA trabaje solo sobre lo desconocido.

## Decisiones pendientes (bloquean partes del plan)
1. **Multi-usuario / hogar:** ¿las features operan por usuario o combinando pareja (`UserSettings.linkedUserId`)? — afecta A, C, D, E. **Dirección elegida:** pool compartido por el usuario primario (ya implementado en `auth.ts`) + atribución por persona vía `ownerUserId` (= `req.authUserId`) en `Account`/`Income`/`Expense`, sin entidad "hogar" separada.
7. **Transferencias entre cuentas:** un traspaso es un cargo + un abono que no deben contar como gasto ni ingreso. ¿Se modela con `transferGroupId` que enlaza ambos movimientos y los excluye de los cálculos? — surge con E2/E.
2. **Fuente de verdad del progreso de planes:** `currentAmount` vs `PlanDeposit` (riesgo de doble conteo) — bloquea C.
3. **`Float` → céntimos/`Decimal`:** ¿se aborda en A? — lo piden #4 y #5.
4. **Notificaciones:** ¿alertas sólo in-app o también email (Resend)/push? — define entidad `Notification` y jobs.
5. **Importación bancaria:** BBVA exporta **`.xlsx`** → ticket **G** (CSV/XLSX) primero, open banking (**H**) después. Decidir librería de lectura (SheetJS vs exceljs) y estrategia de `externalId` derivado.
6. **Divisa:** ¿multi-divisa por cuenta o todo EUR? — afecta E y UI (hoy `€` hardcodeado).
