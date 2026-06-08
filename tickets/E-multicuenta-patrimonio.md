# [Fase E] Multi-cuenta y patrimonio neto

**Tipo:** Epic / Feature (feature #7 del plan)
**Esfuerzo:** L · **Riesgo:** Medio-Alto
**Depende de:** —
**Habilita:** Fase E2 (ingresos transaccionales), Fase F (conciliación de duplicados) y futura importación bancaria

## Contexto
Hoy no existe entidad `Account` y `Expense` no tiene `accountId`. Es el refactor de modelo de mayor alcance porque toca la transacción central y requiere migrar datos existentes. La conciliación de duplicados (Fase F) **no aporta valor** hasta tener cuentas + importación, por eso E va antes.

## Alcance
- Entidad `Account { userId, ownerUserId, name, type (checking|savings|cash|investment|card), currency, currentBalance, isArchived, sortOrder }`. `userId` = pool compartido (primario en parejas); `ownerUserId` = dueño real (`req.authUserId`), para representar "la cuenta de Ana / la de Luis".
- Añadir `Expense.accountId?` + migración de datos: asignar gastos existentes a una cuenta "por defecto" por usuario.
- Patrimonio neto: agregado de saldos de cuenta (decidir si se deriva o se introduce `AccountBalanceSnapshot`).
- CRUD de cuentas (`server/routes/accounts.ts`) siguiendo convenciones (FAB, reorder por `sortOrder`, `{ data }`/`{ error }`).
- Selector de cuenta en alta de gasto (`AddExpense.tsx`) y nueva entrada de navegación en `App.tsx:68`.

## Archivos afectados
- `prisma/schema.prisma` (+ migración con backfill)
- `server/routes/accounts.ts` (nuevo), `server/routes/expenses.ts`, `server/index.ts`
- `src/app/components/AddExpense.tsx`, `Activity.tsx`, nuevo módulo de patrimonio
- `src/app/App.tsx` (navegación), `src/app/hooks/useAccounts.ts` (nuevo)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación
- [ ] Alta/edición/archivado de cuentas con reordenación (`sortOrder`) y `ownerUserId` (atribución por persona en parejas).
- [ ] Todo gasto (nuevo y migrado) pertenece a una cuenta.
- [ ] Alta de gasto incluye selector de cuenta.
- [ ] Vista de patrimonio neto agregado correcta.
- [ ] Migración de datos sin pérdida; gastos existentes quedan en la cuenta por defecto.
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance
- Importación CSV y open banking (sólo se deja el modelo preparado: `Expense.source`/`externalId` ya creados en Fase A).
- Multi-divisa real (depende de decisión pendiente #6).
