# [Fase E2] Ingresos transaccionales (tabla Income)

**Tipo:** Epic / Feature
**Esfuerzo:** M · **Riesgo:** Bajo (no toca el modelo de `Expense`)
**Depende de:** Fase E (entidad `Account` + `ownerUserId`)
**Recomendado tras:** A (patrones `merchant`/`source`/`externalId`), B (reglas)
**Habilita:** cashflow real, patrimonio neto coherente, importación de abonos (Fase G)

## Contexto
Hoy el ingreso **no es transaccional**: es un único número estático `UserSettings.monthlyIncome` (céntimos, `server/lib/money.ts:35`, expuesto en `server/routes/allocations.ts:25`). Para una pareja eso obliga a sumar a mano los dos sueldos (p.ej. 2000 + 1200 → `monthlyIncome = 3200`), sin reflejar de qué cuenta viene ni quién lo aporta.

Las parejas comparten **un único pool de datos**: en `server/middleware/auth.ts` el `linkedUserId` reescribe `req.userId` al usuario primario, así que ambos miembros leen/escriben el mismo conjunto. El `req.authUserId` (usuario real) ya está disponible para atribuir "quién".

Un extracto bancario es una lista de movimientos **con signo**: los cargos son gastos, los abonos son ingresos. Para que la importación (Fase G) registre ambos de forma automática, el ingreso debe ser una transacción de pleno derecho, no un número de ajustes.

## Decisión cerrada
**Tabla `Income` paralela a `Expense`** (no una tabla `Transaction` unificada con `direction`). Motivo: `Expense` ya está cableado en allocations, `monthlyBudgets`, auto-contribución a planes, `categorize` y `normalizeMerchant`; unificar obligaría a refactorizar casi todas las rutas con ramas `if (out)`. Una tabla paralela reutiliza los patrones de la Fase A sin tocar el código de gastos, y la vista de libro mayor (cashflow/patrimonio) es un simple UNION a nivel de query. El único caso que favorecería el modelo unificado son las **transferencias entre cuentas** → ver Fuera de alcance.

## Alcance
- Entidad `Income` espejo de `Expense`:
  ```
  Income {
    userId      String   // pool compartido (= req.userId, primario en parejas)
    ownerUserId String   // quién ingresa (= req.authUserId) — atribución por persona
    accountId   String?  // FK a Account (Fase E); cuenta de abono
    amount      Int      // céntimos
    description String
    merchant    String   // normalizado (reusa normalizeMerchant)
    category    String   @default("salary") // salary | freelance | transfer_in | other
    source      String   @default("manual") // manual | import
    externalId  String?  // idempotencia de importación (@@unique [userId, externalId])
    date        DateTime
  }
  ```
- `monthlyIncome` pasa a ser **baseline/fallback de presupuesto**, no la fuente de verdad. El "Monthly Income" del dashboard (`Home.tsx`, `server/routes/allocations.ts:25`) se vuelve `sum(Income del mes)` cuando hay datos transaccionales; si no, cae al valor estático (mismo patrón que `monthly-budgets` con allocations).
- CRUD `server/routes/income.ts` siguiendo convenciones (`{ data }`/`{ error }`, `requireAuth`, `serializeMoney`); montaje en `server/index.ts`.
- Normalización de `merchant` al crear/editar (reusa `server/lib/normalizeMerchant.ts`).
- UI de alta de ingreso con patrón FAB + modal/sheet; `Activity.tsx` muestra ingresos junto a gastos (con signo/color distinto: verde entrada).
- `useIncome.ts` (hook) análogo a `useExpenses.ts`.
- Atribución por persona en parejas: guardar `ownerUserId = req.authUserId`; la UI puede etiquetar "ingreso de Ana / de Luis" y separar 2000/1200.
- `GET /api/analytics`: extender el cashflow (UNION income/expense por mes) y la serie de ahorro; el indicador de alineación sigue basado en gasto vs presupuesto.

## Archivos afectados
- `prisma/schema.prisma` (+ migración; sin backfill de datos, tabla nueva)
- `server/routes/income.ts` (nuevo), `server/index.ts`, `server/routes/allocations.ts` (income derivado)
- `server/routes/analytics.ts` (cashflow con ingresos)
- `src/app/components/AddIncome.tsx` (nuevo), `Activity.tsx`, `Home.tsx`
- `src/app/hooks/useIncome.ts` (nuevo), `useAnalytics.ts` (tipos cashflow)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación
- [ ] Alta/edición/borrado de ingresos con `merchant` normalizado y `source='manual'`.
- [ ] Cada ingreso guarda `ownerUserId` (usuario real) y `accountId` (cuenta de abono).
- [ ] El "Monthly Income" del dashboard usa `sum(Income del mes)` cuando existe, con fallback a `UserSettings.monthlyIncome`.
- [ ] En pareja, los ingresos de ambos conviven en el pool compartido y son atribuibles por persona.
- [ ] El cashflow de `/api/analytics` refleja ingresos y gastos del rango.
- [ ] `externalId` único por usuario (preparado para dedupe de importación).
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance
- **Transferencias entre cuentas** (un cargo + un abono que no son gasto ni ingreso). Se deja prevista la categoría `transfer_in`, pero el emparejamiento real (`transferGroupId` y exclusión de cálculos) es trabajo futuro — candidato a decisión pendiente nueva.
- Reglas de categorización de ingresos (las reglas de la Fase B son para gastos).
- Multi-divisa real (decisión pendiente #6).
- Importación CSV/open banking (Fases G/H; aquí solo se deja `source`/`externalId` listos).
