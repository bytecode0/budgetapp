# Plan: pagos de deuda + onboarding inicial

_21 oct 2026. La Radiografía se abandona; todo el trabajo va a la BudgetApp (ver CLAUDE.md)._

Dos épicas, en este orden:

1. **Pagos de deuda**: configurar cómo se paga cada deuda (contado a fin de mes, N cuotas, mínimo) y que registrar un pago la vaya reduciendo.
2. **Onboarding**: completar el asistente para cuentas nuevas (ingresos, ahorros, deudas, gastos fijos), ya con el modelo de pago de la épica 1.

La épica 1 va primero porque el paso de deudas del onboarding tiene que preguntar el modo de pago. Si el onboarding se cierra antes, habría que rehacer ese paso.

---

## Estado actual (verificado en el código)

**Deudas**

| Pieza | Estado |
|---|---|
| `Debt` (`prisma/schema.prisma:260`) | Existe. Tipos `credit_card` (corte, vencimiento, mínimo) y de cuotas (`installmentAmount`, `installmentsTotal`, `installmentsPaid`). Importes en céntimos `Int`. |
| Partida de presupuesto de deuda | Existe: `Allocation.type = "debt"` + `debtId`. Su importe se deriva de `minimumPayment ?? installmentAmount` (`server/routes/allocations.ts:59`) y se mantiene sincronizado (`server/routes/debts.ts:250`). |
| `Expense.debtId` | El campo existe, pero **ninguna ruta lo rellena**. `POST /api/expenses` (`server/routes/expenses.ts:109`) lo ignora. |
| Reducir la deuda al pagar | **No existe.** `currentBalance` / `installmentsPaid` solo cambian a mano o por sincronización bancaria. |
| Pago de contado a fin de mes | **No existe.** Una tarjeta que se liquida entera cada mes no se puede expresar: solo hay "pago mínimo". |
| Futuro comprometido (`server/lib/debtTimeline.ts`) | Usa `minimumPayment ?? installmentAmount`. No conoce el modo contado. |

**Onboarding**: ya existe, **sin commitear**, en `src/app/onboarding/` + `server/routes/onboarding.ts` + `src/app/hooks/useOnboardingNeeded.ts`. Flujo: bienvenida → ingresos → ahorros → deudas → presupuesto → resultado. Cada paso escribe filas reales con los hooks de la app (no hay borrador que se envía al final). `needsOnboarding` se deriva (sin ingresos, deudas ni presupuesto), no es un flag guardado.

---

## Paso 0: higiene del repo (antes de nada)

`main` tiene ~40 ficheros modificados o sin trackear que mezclan Radiografía y BudgetApp, y el onboarding entero sin commitear.

- Crear `feature/onboarding` y commitear ahí **solo** el onboarding que ya existe (`src/app/onboarding/`, `server/routes/onboarding.ts`, `useOnboardingNeeded.ts`, `src/app/components/shared/`, y los cambios relacionados en `BudgetApp.tsx`, `server/index.ts`, `useAllocations.ts`, `useDebts.ts`, `locales`).
- Los cambios de la Radiografía que quedan: decidir si se commitean como "último estado" o se descartan junto con su borrado.

---

## Épica 1: pagos de deuda

### Modelo (decisión A: compras en su categoría)

- **Compra con tarjeta** = un gasto normal en su categoría (Súper, Ocio…) con `accountId` = la cuenta de la tarjeta. Cuenta como gasto del presupuesto **y sube** el saldo de la deuda.
- **Pago de la tarjeta** = un gasto con `debtId`, pagado desde la cuenta bancaria. **Baja** el saldo. La parte que cubre compras ya apuntadas es una **transferencia**, no un gasto nuevo (si no, el súper contaría dos veces).
- **Deuda previa** = el saldo que ya había al dar de alta la deuda (p. ej. los 300 € de la PASS de hoy). Esa sí es una partida del presupuesto: hay que reservar dinero para pagarla.
- Los pagos se aplican **primero a la deuda previa** y después a las compras nuevas.

### 1.1 Schema (proponer y aplicar con `db push`)

```prisma
model Debt {
  // ...
  paymentMode   String    @default("minimum") // full | installments | minimum
  balanceAsOf   DateTime? // fecha del saldo ancla (currentBalance), ver 1.2
}
```

- `full`: contado. Se liquida el saldo entero a fin de mes (tarjeta PASS).
- `installments`: N cuotas fijas (6, 10, 12…), con `installmentAmount` × `installmentsTotal`.
- `minimum`: revolving. Se paga el mínimo; el saldo genera intereses (`apr`).

Valores por defecto al hacer `db push`: `credit_card` → `minimum` (lo que asume el código hoy), tipos de cuotas → `installments`. Es aditivo; no se pierden datos.

`Expense` no cambia (`accountId` y `debtId` ya existen). Lo que sí se exige: **una deuda `credit_card` tiene `accountId`** apuntando a una `Account` de tipo `card` (ya existe ese tipo). Si al crear la deuda no hay cuenta, se crea una con el mismo nombre. Así la tarjeta aparece en el selector de cuenta de `AddExpense`.

### 1.2 Saldo derivado (decisión B)

Nada se resta ni se suma a mano: **derivar, no almacenar**, como el periodo de presupuesto.

- **Ancla** = `currentBalance` en la fecha `balanceAsOf` (lo introduce el usuario al dar de alta la deuda, o lo trae la sincronización bancaria).
- **Compras** = gastos con `accountId` = cuenta de la tarjeta, sin `debtId`, **fechados** después del ancla. Una entrada sin hora (solo el día) del mismo día del ancla cuenta si se apuntó después de fijarlo. Así, importar un extracto antiguo no vuelve a sumar compras que el ancla ya incluye.
- **Pagos** = gastos con `debtId` = la deuda, con el mismo criterio de fecha.
- **Ajustes** (`DebtAdjustment`, tabla nueva) = correcciones fechadas del saldo: intereses, una compra sin apuntar, una sincronización bancaria que no cuadra.
- **Saldo efectivo** = ancla + compras + ajustes − pagos.
- **Deuda previa pendiente** = ancla + ajustes − la parte de los pagos aplicada a ella (los pagos se reparten en orden cronológico).
- **Cuotas pagadas** (modo `installments`) = `installmentsPaid` + nº de pagos después del ancla.
- **Ajustar saldo a X**: si aún no hay movimientos, se corrige el ancla (y su fecha pasa a hoy). Si ya los hay, la diferencia se guarda como **ajuste fechado hoy**: cuenta como deuda previa desde hoy y **no reparte de nuevo pagos de meses cerrados**. La sincronización bancaria usa el mismo mecanismo.
- Una deuda que no es tarjeta pasa a `paid_off` al llegar a 0 (o al pagar todas las cuotas), y vuelve a `active` si se borra un pago. La partida se mide al inicio del periodo, así que el mes del último pago conserva su importe.
- No se puede borrar una deuda con pagos, ni una cuenta vinculada a una deuda, ni cambiar la cuenta de una deuda con movimientos: reescribiría meses cerrados.
- Límite conocido: "el mismo día del ancla" es el día UTC. Bien para España; un usuario al oeste de UTC que cree la deuda a última hora de su tarde vería excluidas las entradas de esa tarde.

Un único módulo `server/lib/debtBalance.ts` (funciones puras + tests) calcula todo esto. Lo usan `GET /api/debts`, `debtTimeline`, `debtPayoff`, el dashboard y el resultado del onboarding. Ninguno vuelve a leer `currentBalance` en crudo.

### 1.3 Registrar compras y pagos

- **Compra:** ya funciona con `AddExpense` (elige categoría + cuenta). Solo hay que asegurar que las cuentas `card` salen en el selector.
- **Pago:** botón "Pagar tarjeta" / "Registrar pago" en cada deuda. Abre la hoja estándar con: cuenta de origen (bancaria), importe prellenado según el modo (en contado, el saldo efectivo) y fecha. Crea un gasto con `debtId` y la partida de esa deuda.
- `POST /api/expenses`: si la partida elegida es de tipo `debt`, el servidor hereda `debtId` (el cliente no lo manda). Igual en `PATCH` al reasignar y en la importación de extractos. Un pago cuya `accountId` es la propia tarjeta se rechaza (400).

### 1.4 Que el pago no cuente dos veces

Hoy todo `Expense` cuenta como gasto. Con este modelo, de cada pago **solo la parte que cubre deuda previa** es gasto del presupuesto (va a la partida de la deuda). El resto es transferencia y se excluye.

- Helper `splitPayments(debt, payments)` en `debtBalance.ts` → por cada pago, `{ toPrevious, toPurchases }`.
- Hay que revisar cada sitio que suma gastos: `server/routes/dashboard.ts`, `monthlyBudgets.ts`, `analytics.ts`, `expenses.ts`, `server/lib/suggestBudgets.ts`, `recurring.ts`. El gastado de la partida de deuda = `toPrevious` del periodo. `toPurchases` no suma en ningún total de gasto.
- Es el punto con más riesgo de la épica: si se olvida un sitio, ese total cuenta el súper dos veces. Lleva test.

### 1.5 Partida del presupuesto según el modo

Un helper `monthlyCommitment(debt)` reemplaza a `minimumPayment ?? installmentAmount`, que hoy está repetido en `allocations.ts`, `debts.ts` y `debtTimeline.ts`:

| Modo | Importe de la partida |
|---|---|
| `full` | deuda previa pendiente (las compras nuevas ya están presupuestadas en su categoría) |
| `installments` | `installmentAmount` (0 cuando ya no quedan cuotas) |
| `minimum` | `minimumPayment` |

En `debtTimeline` (futuro comprometido), `full` cuenta la deuda previa en el periodo actual y desaparece. Las compras nuevas no son "futuro comprometido": ya son gasto presupuestado.

### 1.6 UI de Deudas (`src/app/components/Debts.tsx`)

- Selector de modo de pago al crear o editar: Contado fin de mes / En cuotas (6, 10, 12, 18, 24 u otro) / Pago mínimo.
- Tarjeta de crédito: elegir o crear la cuenta vinculada.
- Tarjeta de cada deuda: saldo efectivo desglosado ("deuda previa 300 € · compras 50 €"), barra de progreso, "cuota X de N", próximo vencimiento, "Registrar pago" y "Ajustar saldo".
- Historial: compras y pagos de la deuda.

### 1.7 Verificación

- Tests unitarios de `debtBalance` (`saldo efectivo`, `splitPayments`, ajuste) y `monthlyCommitment` (`node --import tsx --test <fichero>`).
- Manual, el caso de la PASS: alta en contado con 300 € de deuda previa → partida del mes 300. Compra de 50 € en "Súper" con la PASS → saldo 350, partida sigue en 300, Súper gastado 50. Pago de 350 desde el banco → saldo 0, `paid_off`, partida pagada 300, **gasto total del mes 350, no 400**.
- Cuotas: 6 × 50 € → pagar 2 → "cuota 2 de 6", saldo 200. Borrar un pago → vuelve a 250.

### 1.8 Después (no en esta épica): ciclo de facturación

Con `statementDay` / `paymentDueDay`, separar "lo que vence este mes" (compras hasta el corte) de "saldo total" (incluye compras después del corte, que vencen el mes siguiente). Es el diferenciador de "dos ejes de tiempo" de la memoria del producto. Este modelo lo permite sin cambiar el schema.

---

## Épica 2: onboarding

El esqueleto está hecho. Falta:

### 2.1 Paso de deudas (`DebtsStep.tsx`)
- Añadir el modo de pago (épica 1) con la misma UI que en Deudas: contado / cuotas (cuántas y cuántas pagadas) / mínimo.
- Día de vencimiento (`paymentDueDay`) para que el presupuesto sepa cuándo cae.
- Lo que se introduce como saldo es la **deuda previa** (ancla). Para tarjetas, crear su cuenta `card` y explicar: "A partir de ahora, apunta las compras con esta tarjeta eligiendo la cuenta «<nombre>»".
- Mostrar en el formulario los tipos `bnpl` y `payday_loan`, que hoy faltan en `DEBT_KINDS` (son justo el usuario objetivo).

### 2.2 Paso de gastos fijos (`BudgetStep.tsx`)
- Hoy mezcla fijos y flexibles con 5 sugerencias. Lo que se pidió es "presupuesto de gastos **fijos** mensuales": separarlo en dos bloques (fijos primero, luego flexibles) y ampliar las sugerencias de fijos: alquiler, suministros, teléfono e internet, seguros, suscripciones, transporte, colegio o guardería.
- Las partidas de deuda aparecen ya calculadas y bloqueadas (con el importe según el modo).

### 2.3 Ingresos y ahorros
- `IncomeStep`: preguntar también el **día de cobro** (`cycleStartDay`). Es la decisión de producto "un solo día de cobro por hogar" y hoy no se pregunta en ningún paso.
- `SavingsStep`: los nombres de cuenta `'Ahorros'` / `'Inversiones'` están hardcodeados. Pasarlos a i18n.

### 2.4 Abandonar a medias
`needsOnboarding` solo es `true` si **no hay nada**. Si el usuario mete el ingreso y cierra, aterriza en el dashboard medio configurado y no vuelve a ver el asistente. Propuesta: mantener la derivación (sin flag guardado) y que `/api/onboarding/status` devuelva el checklist (`hasIncome`, `hasDebts`, `hasFixedBudget`). El dashboard muestra una tarjeta "Completa tu configuración" con lo que falte, que reabre el asistente en ese paso.

### 2.5 Deuda técnica a arreglar de paso (reglas del CLAUDE.md)
- `€` hardcodeado en todos los pasos → símbolo de moneda desde i18n.
- Inputs numéricos: separador de miles y aceptar `0`.
- Cada clave nueva en `es.json` **y** `en.json`.

### 2.6 Verificación
Cuenta nueva → recorrer los 4 pasos → comprobar en Deudas, Presupuesto y Dashboard que todo aparece. Repetir abandonando en el paso 2 → debe aparecer la tarjeta de "completa tu configuración".

---

## Decisiones

### Tomadas (21 oct 2026)

**A. Compras con tarjeta → se apuntan en su categoría y suben el saldo de la tarjeta.** El pago de la tarjeta baja el saldo y solo cuenta como gasto la parte que cubre deuda previa (ver "Modelo" y 1.4). Se eligió primero la opción simple (solo apuntar el pago) y se cambió el mismo día: este modelo conserva en qué categorías se gasta con tarjeta y prepara el ciclo de facturación (1.8).

**B. Saldo → derivado** (sección 1.2). Se descarta mutar `currentBalance` en cada movimiento.

### Abiertas

**C. Código de la Radiografía:** ¿se borra ya (y se desmontan `/api/radiografia` y `/api/xray`, que siguen públicas) o más adelante? ¿Se rescatan los parsers de extractos para la importación de la BudgetApp?

**D. Flag `VITE_ENABLE_BUDGETAPP`:** pasarlo a `true` en producción o eliminarlo.
