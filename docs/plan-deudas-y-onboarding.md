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

## Épica 1: pagos de deuda — HECHA (rama `feature/deudas-pagos`, pendiente de probar en el navegador)

> **Rediseño del 21 oct (sobre la marcha):** la tarjeta de crédito es una **cuenta** (tipo "Tarjeta de crédito"), no algo que se crea en Deudas. Al crearla en Cuentas se elige la modalidad (contado a fin de mes / pago mínimo) y lo que se debe hoy; el servidor crea y mantiene la deuda detrás (`server/lib/cardDebt.ts`). El menú Deudas queda como vista de todo lo que se debe, y solo se crean ahí préstamos y planes de cuotas. "Pagar tarjeta" (parcial o total) está en el + de Actividad, en cada tarjeta de Cuentas y en cada deuda. Las secciones de abajo describen el modelo de cálculo, que no cambió; 1.3 y 1.6 se ven superadas por este rediseño.

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

### 1.6 UI de Deudas (`src/app/components/Debts.tsx`) — superada por el rediseño de arriba

- Selector de modo de pago al crear o editar: Contado fin de mes / En cuotas (6, 10, 12, 18, 24 u otro) / Pago mínimo.
- Tarjeta de crédito: elegir o crear la cuenta vinculada.
- Tarjeta de cada deuda: saldo efectivo desglosado ("deuda previa 300 € · compras 50 €"), barra de progreso, "cuota X de N", próximo vencimiento, "Registrar pago" y "Ajustar saldo".
- Historial: compras y pagos de la deuda.

### 1.7 Verificación

- Tests unitarios de `debtBalance` (`saldo efectivo`, `splitPayments`, ajuste) y `monthlyCommitment` (`node --import tsx --test <fichero>`).
- Manual, el caso de la PASS: alta en contado con 300 € de deuda previa → partida del mes 300. Compra de 50 € en "Súper" con la PASS → saldo 350, partida sigue en 300, Súper gastado 50. Pago de 350 desde el banco → saldo 0, `paid_off`, partida pagada 300, **gasto total del mes 350, no 400**.
- Cuotas: 6 × 50 € → pagar 2 → "cuota 2 de 6", saldo 200. Borrar un pago → vuelve a 250.

### 1.8 Pendiente para después de la épica 1

- **Fraccionar una compra concreta de la tarjeta en N cuotas** (decidido 21 oct: la modalidad va por tarjeta; fraccionar compras, más adelante).
- **Ciclo de facturación** (abajo).

### 1.9 Ciclo de facturación

Con `statementDay` / `paymentDueDay`, separar "lo que vence este mes" (compras hasta el corte) de "saldo total" (incluye compras después del corte, que vencen el mes siguiente). Es el diferenciador de "dos ejes de tiempo" de la memoria del producto. Este modelo lo permite sin cambiar el schema.

---

## Épica 2: limpieza y despliegue (budget.luisvespa.com)

Va **antes** del onboarding: así el onboarding se prueba "desde cero" de verdad, con una cuenta nueva sobre una base de datos de producción vacía, en la URL real.

Decisiones del 21 oct: CI/CD automático **y** comando `/deploy`; Postgres en **Neon vía Vercel Marketplace**; **borrar** la Radiografía; DNS de `luisvespa.com` en **Cloudflare**.

### 2.1 Borrar la Radiografía (requisito para publicar)
Sus rutas `/api/radiografia` y `/api/xray` son públicas, sin login, y pueden gastar en la API de Anthropic.
- Borrar `src/radiografia/`, `server/lib/radiografia/`, `server/lib/xray/`, `server/routes/radiografia.ts`, `server/routes/xray.ts`, `server/routes/internalPurge.ts` y sus scripts (`radiografiaStats`, `previewReportEmail`), el desvío `/radiografia` y `/informe` de `src/app/App.tsx`, sus claves `radiografia.*` en los locales y su copy en `index.html` (título y meta tags pasan a ser los de la BudgetApp).
- Antes de borrar: comprobar qué usa la BudgetApp de ahí. La importación de extractos (`server/lib/importStatement.ts`) es de la BudgetApp y se queda; si importa algo de `server/lib/xray/` (parsers, `heuristicColumnMap`), se mueve fuera, no se pierde.
- Modelos Prisma de la Radiografía (`XRaySession`, `FinancialProfile`, `Radiografia`, `ProfileDebt`…): se quitan del schema **solo en el código**; la base de producción nace sin ellos. La local se limpia aparte cuando decidas (borrar tablas es irreversible: lo haces tú).
- Quitar el flag `VITE_ENABLE_BUDGETAPP`: con la Radiografía fuera ya no oculta nada; la BudgetApp siempre está montada.
- CLAUDE.md: quitar las secciones "legacy — Radiografía".

### 2.2 Preparar la app para Vercel
- **Un solo proyecto con Vercel Services:** `frontend` (Vite, build estático, catch-all a `index.html` para la SPA) y `backend` (Express como Vercel Function). Reescrituras: `/api/(.*)` → backend, el resto → frontend. Mismo dominio, así que las cookies de sesión siguen funcionando sin CORS entre dominios. (Si Services da guerra con ambos servicios en la raíz del repo, alternativa: Vite estático + una función `api/[...path].ts` que envuelve la app Express.)
- `server/index.ts`: exportar la `app` y dejar `app.listen` solo para local.
- **Prisma + Neon:** `DATABASE_URL` con pooling (serverless) y `DIRECT_URL` sin pooling para `db push`; `prisma generate` en el build (`postinstall`). Seguimos con `db push`, nunca migraciones (CLAUDE.md).
- Revisar lo que asume un proceso siempre vivo (temporizadores, caché en memoria, la sincronización bancaria): en serverless no existe. Lo que deba ser periódico va a **Vercel Cron Jobs** con `CRON_SECRET`.
- `index.html`: título, descripción y `lang` de la BudgetApp.

### 2.3 Variables de entorno en Vercel (las pones tú; nunca pasan por el código ni por mí)
`DATABASE_URL` / `DIRECT_URL` (las inyecta Neon), `JWT_SECRET`, `ENCRYPTION_KEY`, `APP_URL=https://budget.luisvespa.com`, `RESEND_API_KEY` + `EMAIL_FROM` (dominio verificado), `GOOGLE_CLIENT_ID/SECRET` + `GOOGLE_CALLBACK_URL` (añadir la URL nueva en Google Cloud Console), `STRIPE_*` (webhook nuevo apuntando al dominio), `GOCARDLESS_*` / `TINK_*` si se usa Open Banking, `ANTHROPIC_API_KEY` (opcional: ahora todas sus rutas tienen login), `CRON_SECRET`. Separar Production y Preview (Preview con su propia base de Neon).

### 2.4 Dominio
En Cloudflare: registro `CNAME budget → cname.vercel-dns.com` con el **proxy desactivado** (nube gris, "DNS only"), para que Vercel emita el certificado. En Vercel: añadir `budget.luisvespa.com` al proyecto.

### 2.5 CI/CD
- **GitHub Actions** (`.github/workflows/verify.yml`): en cada PR y push a `main`, `npm ci` + `npm run verify` (typecheck, tests, build). Los tests no necesitan base de datos.
- **Vercel Git integration** con `bytecode0/budgetapp`: cada PR → preview; `main` → producción. Proteger `main` en GitHub para que solo se fusione con el check en verde.
- Cambios de schema en producción: **no** automáticos. `db push` contra Neon lo lanza `/deploy` con confirmación explícita (ver 2.6).

### 2.6 Comando `/deploy` (skill de Claude Code en `.claude/skills/deploy/`)
1. Comprueba rama y árbol limpios, y corre `npm run verify`.
2. Si `prisma/schema.prisma` cambió desde el último despliegue: enseña el diff y **pide confirmación** antes de `prisma db push` contra producción (nunca `--force-reset`, nunca `--accept-data-loss` sin preguntar).
3. Empuja a GitHub (con confirmación) y espera al check de GitHub Actions y al despliegue de Vercel.
4. Comprueba producción: `GET https://budget.luisvespa.com/api/health` → `{ ok: true }`, la home responde 200 y una ruta protegida devuelve 401 (no 500).
5. Informa con la URL del despliegue y cómo hacer rollback (`vercel rollback`).

### 2.7 Verificación
Preview desplegado → health OK → registrarse con un email nuevo → llega el onboarding → login con Google funciona con la URL nueva → un gasto y un pago de tarjeta se guardan. Luego producción con el dominio.

---

## Épica 3: onboarding desde cero

Objetivo: una persona que se registra hoy, sin nada, sale del onboarding con **ingresos, ahorros, tarjetas, préstamos y gastos fijos** configurados y ve su "futuro comprometido". Se prueba siempre con **una cuenta nueva** en el entorno desplegado (o local con `npm run reset:onboarding`).

### 3.1 Flujo nuevo

| Paso | Qué se pide | Qué se crea |
|---|---|---|
| 0. Bienvenida | — | — |
| 1. Ingresos | Ingreso neto mensual (uno o varios) y **día de cobro** | `Income`, `UserSettings.monthlyIncome`, `cycleStartDay` |
| 2. Ahorros | Lo ahorrado y lo invertido hoy | Cuentas `cash` / `investment` |
| 3. Cuenta del banco | Tu cuenta principal y su saldo (desde ella pagas las tarjetas) | Cuenta `checking` — hoy falta: sin ella "Pagar tarjeta" no tiene origen |
| 4. Tarjetas | Cada tarjeta: nombre, modalidad (contado / mínimo), lo que debes hoy, día de pago | Cuenta tipo tarjeta + su deuda y su partida (mismo flujo que Cuentas, `server/lib/cardDebt.ts`) |
| 5. Préstamos y cuotas | Coche, Klarna, préstamo rápido…: cuota, nº de cuotas, cuántas pagadas, saldo | `Debt` + su partida automática |
| 6. Gastos fijos | Alquiler/hipoteca, suministros, internet y teléfono, seguros, suscripciones, colegio | Partidas `fixed` (la hipoteca ya está como deuda: no se duplica) |
| 7. Gastos variables | Súper, transporte, ocio… | Partidas `flexible` |
| 8. Resultado | Futuro comprometido, deuda total, fecha de libertad, qué sobra | — |

Cada paso escribe filas reales (como hoy) y se puede saltar. "Atrás" no borra nada.

### 3.2 Cambios respecto a lo que existe
- **Pasos nuevos:** cuenta del banco (3), tarjetas separadas de préstamos (4 y 5), fijos separados de variables (6 y 7).
- **Tarjetas en el onboarding = tarjetas en Cuentas:** reutilizar el mismo formulario (modalidad, lo que debes, día de pago) en vez de duplicarlo.
- **Préstamos:** reutilizar el formulario de Deudas (modalidad, cuotas con atajos 6/10/12/24, cuántas pagadas). Añadir `bnpl` y `payday_loan`, que faltan.
- **Día de cobro** en Ingresos.
- **Abandonar a medias:** `/api/onboarding/status` devuelve el checklist (`hasIncome`, `hasBankAccount`, `hasCards`, `hasDebts`, `hasFixedBudget`); el dashboard muestra "Completa tu configuración" con lo que falte, que reabre el asistente en ese paso. Sigue siendo estado derivado, sin flag guardado.
- **Deuda técnica:** `€` hardcodeado → `currency.symbol`; nombres `'Ahorros'`/`'Inversiones'` a i18n; textos en `es.json` y `en.json`.

### 3.3 Verificación (cuenta desde cero)
1. Registro con email nuevo → aparece la bienvenida.
2. Recorrer los 8 pasos con un caso real: 2.000 € el día 1, 3.000 € ahorrados, cuenta del banco con 800 €, PASS en contado con 300 €, Klarna 6×50 € (2 pagadas), alquiler 700 €, súper 300 €.
3. Resultado: futuro comprometido = (300 + 50) / 2.000 = 17,5 %.
4. Comprobar en Cuentas (banco + PASS "Debes 300 €"), Deudas (PASS + Klarna), Presupuesto (partidas 🔒 300 y 50, alquiler, súper).
5. Repetir con otra cuenta nueva abandonando en el paso 4 → al volver, "Completa tu configuración" lleva al paso de tarjetas.
6. Con la cuenta del paso 2: compra de 50 € con la PASS y "Pagar tarjeta" 350 € → gasto total del mes 350.

---

## Decisiones

### Tomadas (21 oct 2026)

**A. Compras con tarjeta → se apuntan en su categoría y suben el saldo de la tarjeta.** El pago de la tarjeta baja el saldo y solo cuenta como gasto la parte que cubre deuda previa (ver "Modelo" y 1.4). Se eligió primero la opción simple (solo apuntar el pago) y se cambió el mismo día: este modelo conserva en qué categorías se gasta con tarjeta y prepara el ciclo de facturación (1.9).

**B. Saldo → derivado** (sección 1.2). Se descarta mutar `currentBalance` en cada movimiento.

**C. Radiografía → se borra** antes del primer despliegue (2.1). Los parsers de extractos que use la BudgetApp se conservan.

**D. Flag `VITE_ENABLE_BUDGETAPP` → se elimina** (2.1).

**E. Tarjetas = cuentas** (rediseño de la épica 1); la modalidad va por tarjeta; fraccionar compras, más adelante.

**F. Despliegue:** Vercel (un proyecto, frontend + backend), Neon, Cloudflare para el DNS, CI con GitHub Actions + Vercel Git, y `/deploy` como comando de Claude.

### Abiertas

**G.** ¿Se usa Open Banking (GoCardless/Tink) en producción desde el principio, o queda desactivado hasta más adelante?
