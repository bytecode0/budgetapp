# Plan de desarrollo de LifePlan

_21 oct 2026. La Radiografía se abandona; todo el trabajo va a la BudgetApp (ver CLAUDE.md)._

Dos épicas, en este orden:

1. **Pagos de deuda**: configurar cómo se paga cada deuda (contado a fin de mes, N cuotas, mínimo) y que registrar un pago la vaya reduciendo.
2. **Onboarding**: completar el asistente para cuentas nuevas (ingresos, ahorros, deudas, gastos fijos), ya con el modelo de pago de la épica 1.

La épica 1 va primero porque el paso de deudas del onboarding tiene que preguntar el modo de pago. Si el onboarding se cierra antes, habría que rehacer ese paso.

---

## Estado a 28 oct 2026

| Épica | Estado |
|---|---|
| 1. Pagos de deuda | Hecha |
| 2. Limpieza y despliegue | **Desplegada el 23 oct** en https://budget.luisvespa.com (PR #2, `cd4cf8b`) |
| 3. Onboarding desde cero | Hecha, en producción |
| **4. Importación de ficheros** (cuentas y tarjetas) | **Siguiente** |
| **5. Conexión con bancos (PSD2)** | Después de la 4; bloqueada para usuarios reales hasta firmar con un proveedor |
| Ciclo de facturación de la tarjeta (1.9) | Pendiente; se apoya en el modo tarjeta de la épica 4 |

**La app es gratuita.** Stripe queda para un futuro lejano (decisión I): el código sigue ahí, sin variables `STRIPE_*` responde 503 y el frontend oculta Premium.

### Pendientes sueltos — PR de mantenimiento (`feature/mantenimiento`, 29 oct)
Hecho en este PR (317 tests unitarios + 7 de integración contra Postgres real, `npm run test:integration`):
- ~~2. Sin valores por defecto en `JWT_SECRET` y `GOOGLE_CALLBACK_URL`~~ (`7e468b1`).
- ~~3. Cuentas, deudas e ingresos: solo el dueño edita o borra~~; reordenar solo lo visible; la deuda de una tarjeta sigue a su cuenta; una deuda solo se enlaza a una cuenta de su mismo dueño.
- ~~4. Idioma al registrarse~~ (email y Google, por el `state` de OAuth).
- ~~5. "Completa tu configuración" se refresca~~ al volver a Inicio y al recuperar el foco.
- ~~6. Textos sin i18n~~: partidas por defecto en el idioma del usuario, sin `€` a mano en componentes, textos junto a importes traducidos. Quedan algunos (ver abajo).
- ~~7. "No tengo tarjetas / préstamos"~~ (`UserSettings.noCardsAt/noLoansAt`).
- ~~10. Finanzas compartidas~~: la invitación se acepta antes del onboarding (también tras registrarse con Google); al aceptar, los datos de la invitada pasan al pool a su nombre; el ingreso base del hogar suma a los dos y cada uno edita el suyo; desenlazar devuelve a cada uno lo suyo sin cambiar saldos; script `repair:partner-data` para parejas ya enlazadas.
- ~~11. `/privacy` y `/terms`~~ (borrador: **revisarlo Luis**, y alguien con criterio legal antes de abrir la beta).
- Limpieza: 7 pantallas antiguas con datos de prueba borradas.

**Para desplegar este PR (en este orden):**
1. `db push` en producción **antes** de fusionar: columnas nuevas `UserSettings.noCardsAt`, `noLoansAt`, `Expense.createdByUserId`, `LifePlan.ownerUserId` (todas opcionales). Sin ellas, añadir gastos, importar o crear planes da 500 a todos.
2. Confirmar que `JWT_SECRET` tiene valor en Vercel.
3. Fusionar y desplegar.
4. `repair:partner-data` contra producción: primero en seco, luego `--apply --fix-double-counted-baselines`.

Siguen abiertos:
1. **Rotar la contraseña de Neon.** Luis.
8. Skill `/deploy`: reescribir el paso de schema (variables *Sensitive*, base vacía en el primer despliegue).
9. Para cuando vuelva Stripe: el webhook responde 200 aunque falle.
12. **Protección CSRF del login con Google** (`state` aleatorio en cookie): pendiente del OK de Luis.
13. **Deudas de la pareja: ¿compartidas con el hogar?** **Decidido (Luis, 29 oct): una sola finanza.** Al aceptar, sus cuentas, deudas y conexiones bancarias entran como "household" (siguen siendo suyas); el futuro comprometido, el timeline y el resultado del onboarding del hogar cuentan las deudas de los dos. Ella puede marcar después una cuenta como privada.
14. i18n restante: `€` dentro de algunas cadenas traducidas (`planDetail.simulationNote`, `home.overBudgetBy`, `editExpense.splitTotal`…), toasts en inglés en ForgotPassword/VerifyEmail/GoogleCallback/PlanningSettings, meses en inglés en la fecha estimada de PlanDetail.
15. Gastos y planes creados **estando enlazados antes de esta versión** no tienen autor: al desenlazar se quedan en el pool. El script en seco dice cuántos hay.

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

## Épica 2: limpieza y despliegue (budget.luisvespa.com) — DESPLEGADA el 23 oct

Va **antes** del onboarding: así el onboarding se prueba "desde cero" de verdad, con una cuenta nueva sobre una base de datos de producción vacía, en la URL real.

Decisiones del 21 oct: CI/CD automático **y** comando `/deploy`; Postgres en **Neon vía Vercel Marketplace**; **borrar** la Radiografía; DNS de `luisvespa.com` en **Cloudflare**; emails con un módulo independiente del proveedor, **Resend** en la beta (2.8, decisión del 23 oct); Stripe configurado desde la beta (2.9).

### 2.1 Borrar la Radiografía (requisito para publicar) — HECHO (`233b7ab`)
Sus rutas `/api/radiografia` y `/api/xray` son públicas, sin login, y pueden gastar en la API de Anthropic.
- Borrar `src/radiografia/`, `server/lib/radiografia/`, `server/lib/xray/`, `server/routes/radiografia.ts`, `server/routes/xray.ts`, `server/routes/internalPurge.ts` y sus scripts (`radiografiaStats`, `previewReportEmail`), el desvío `/radiografia` y `/informe` de `src/app/App.tsx`, sus claves `radiografia.*` en los locales y su copy en `index.html` (título y meta tags pasan a ser los de la BudgetApp).
- Antes de borrar: comprobar qué usa la BudgetApp de ahí. La importación de extractos (`server/lib/importStatement.ts`) es de la BudgetApp y se queda; si importa algo de `server/lib/xray/` (parsers, `heuristicColumnMap`), se mueve fuera, no se pierde.
- Modelos Prisma de la Radiografía (`XRaySession`, `FinancialProfile`, `Radiografia`, `ProfileDebt`…): se quitan del schema **solo en el código**; la base de producción nace sin ellos. La local se limpia aparte cuando decidas (borrar tablas es irreversible: lo haces tú).
- Quitar el flag `VITE_ENABLE_BUDGETAPP`: con la Radiografía fuera ya no oculta nada; la BudgetApp siempre está montada.
- CLAUDE.md: quitar las secciones "legacy — Radiografía".

### 2.2 Preparar la app para Vercel
- **Hecho:** un solo proyecto (`vercel.json`): Vite como sitio estático y Express como una Vercel Function en `api/index.ts`. Reescrituras: `/api/(.*)` → la función, el resto → `index.html` (SPA). Mismo dominio, así que las cookies de sesión funcionan sin CORS entre dominios. Región `fra1` (Fráncfort): crear la base de Neon en la misma región.
- **Hecho:** `server/app.ts` exporta la app; `server/index.ts` solo escucha en local. `/api/health` devuelve el commit desplegado.
- **Hecho:** el cliente de Resend se crea al primer envío (antes tumbaba toda la app si faltaba `RESEND_API_KEY`). Superado por el módulo de email de 2.8. `server/lib/stripe.ts` tiene el mismo problema sin `STRIPE_SECRET_KEY`: se arregla en 2.9.
- **Límite de Vercel:** el cuerpo de una petición es de 4,5 MB como máximo. Los extractos se suben en base64 en el body: un fichero de más de ~3 MB fallará con 413. Si pasa en la práctica, subir el fichero a Vercel Blob directamente desde el navegador.
- **Prisma + Neon:** en runtime, `DATABASE_URL` (con pooling, la que inyecta Neon). Para `db push`, la URL sin pooling (`DATABASE_URL_UNPOOLED`), como hace `/deploy`. Si aparecen errores tipo "prepared statement already exists", añadir `pgbouncer=true` a la URL con pooling. **Hecho:** `prisma generate` en `postinstall`. Seguimos con `db push`, nunca migraciones (CLAUDE.md).
- Revisado: no hay temporizadores ni trabajos periódicos en el servidor. Si Open Banking vuelve (fase futura), su sincronización periódica irá a **Vercel Cron Jobs** con `CRON_SECRET`.
- `index.html`: título, descripción y `lang` de la BudgetApp.

### 2.3 Variables de entorno en Vercel (las pones tú; nunca pasan por el código ni por mí)
`DATABASE_URL` / `DIRECT_URL` (las inyecta Neon), `JWT_SECRET`, `ENCRYPTION_KEY`, `APP_URL=https://budget.luisvespa.com`, `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM="LifePlan <contact@luisvespa.com>"` (ver 2.8), `GOOGLE_CLIENT_ID/SECRET` + `GOOGLE_CALLBACK_URL` (añadir la URL nueva en Google Cloud Console), `STRIPE_SECRET_KEY` + `STRIPE_PREMIUM_PRICE_ID` + `STRIPE_WEBHOOK_SECRET` (ver 2.9), `GOCARDLESS_*` / `TINK_*` **no** (Open Banking queda apagado en producción hasta su fase; sin esas variables se desactiva solo), `ANTHROPIC_API_KEY` (opcional: ahora todas sus rutas tienen login), `CRON_SECRET`. Separar Production y Preview (Preview con su propia base de Neon).

### 2.4 Dominio
En Cloudflare: registro `CNAME budget → cname.vercel-dns.com` con el **proxy desactivado** (nube gris, "DNS only"), para que Vercel emita el certificado. En Vercel: añadir `budget.luisvespa.com` al proyecto.

### 2.5 CI/CD — HECHO (`70baaad`)
- **GitHub Actions** (`.github/workflows/verify.yml`): en cada PR y push a `main`, `npm ci` + `npm run verify` (typecheck, tests, build). Los tests no necesitan base de datos.
- **Vercel Git integration** con `bytecode0/budgetapp`: cada PR → preview; `main` → producción. Vercel despliega aunque el CI falle; por eso `/deploy` corre las mismas comprobaciones en local antes de empujar.
- Cambios de schema en producción: **no** automáticos. `db push` contra Neon lo lanza `/deploy` con confirmación explícita (ver 2.6).

### 2.6 Comando `/deploy` (skill de Claude Code en `.claude/skills/deploy/`) — HECHO (`70baaad`)
1. Comprueba rama y árbol limpios, y corre `npm run verify`.
2. Si `prisma/schema.prisma` cambió desde el último despliegue: enseña el diff y **pide confirmación** antes de `prisma db push` contra producción (nunca `--force-reset`, nunca `--accept-data-loss` sin preguntar).
3. Empuja a GitHub (con confirmación) y espera al check de GitHub Actions y al despliegue de Vercel.
4. Comprueba producción: `GET https://budget.luisvespa.com/api/health` → `{ ok: true }`, la home responde 200 y una ruta protegida devuelve 401 (no 500).
5. Informa con la URL del despliegue y cómo hacer rollback (`vercel rollback`).

### 2.7 Verificación
Preview desplegado → health OK → registrarse con un email nuevo → **llega el email de verificación (2.8)** → llega el onboarding → login con Google funciona con la URL nueva → un gasto y un pago de tarjeta se guardan → **suscripción Premium de prueba de punta a punta (2.9)**. Luego producción con el dominio.

### 2.8 Emails: módulo independiente del proveedor, Resend en la beta — HECHO (verificado en local el 23 oct)
Decisión del 23 oct (sustituye a la del 21 oct): **Resend** para la beta y el primer despliegue. Su plan gratis envía a cualquier destinatario una vez verificado el dominio (3.000 emails/mes, **100/día**); la restricción "solo a mi email" era del dominio de pruebas `onboarding@resend.dev`. Cloudflare Email Sending exige Workers Paid (5 $/mes) para enviar a usuarios; la web personal envía gratis porque solo manda a una dirección verificada (tu buzón). Cuando la beta crezca o se acerque a 100/día, se cambia a Cloudflare con **una variable**, sin tocar código.

**Diseño (`server/lib/email/`, ver la sección "Emails" del CLAUDE.md):**
- **Transportes** (`transports/`): `resend` (beta), `cloudflare` (preparado), `console` (solo desarrollo local; se niega en producción y en cualquier entorno de Vercel). Se elige con `EMAIL_PROVIDER`, leído al enviar. Añadir un proveedor = un fichero + una línea en el registro. Timeout de 10 s; los errores no incluyen claves ni direcciones.
- **Plantillas** independientes del proveedor: `theme.ts` (marca, colores, logo, soporte = `contact@luisvespa.com`, precio Premium), `components.ts` (bloques HTML compatibles con Gmail/Outlook, cada uno con su versión en texto), `locales/{es,en}.ts` (español por defecto), una plantilla por email → `{ subject, html, text }`. Todo valor del usuario se escapa.
- Los 8 emails (verificación, reset, bienvenida, bienvenida Google, invitación de pareja, suscripción activada/cancelada, pago fallido) salen en el idioma del usuario; la verificación, en el idioma de la web al registrarse. Cancelación y pago fallido llevan Reply-To al soporte.
- Textos revisados contra el código: sin promesas de funciones que no existen (Premium hoy no limita nada → "acceso Premium" sin lista).
- `npm run email:preview` → `.email-preview/index.html` con todos los emails en ambos idiomas.

**Pendiente (tuyo):**
1. **Resend:** añadir el dominio `luisvespa.com` y copiar sus registros DNS (DKIM `resend._domainkey`, MX y SPF en `send.`) en Cloudflare con el proxy desactivado. API key con "Sending access" solo para ese dominio.
2. `.env.example` (bloqueado para mí) y tu `.env` local: `EMAIL_PROVIDER=console` mientras no haya clave; luego `resend`.
3. Revisar los textos en español con `npm run email:preview` (el español es la fuente de verdad).
4. En Vercel (Production y Preview): `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM="LifePlan <contact@luisvespa.com>"`.

**Verificado en local (23 oct):** recuperar contraseña llega correctamente con la plantilla real. Antes: dominio `luisvespa.com` verificado en Resend; un envío de prueba fue aceptado (`id 01a167de-…`) y **llegó a spam** en un buzón corporativo (marcado como no spam). Pendiente: comprobar SPF/DKIM/DMARC en las cabeceras, añadir `_dmarc` (`v=DMARC1; p=none;`) si falta, y repetir con un email real de la app (reset de contraseña) en Gmail y Outlook.

**Abierto, menor:** el idioma no se guarda al registrarse (los ajustes se crean al verificar el email), así que la bienvenida y un código reenviado salen en español a quien se registró en inglés. Arreglo sin schema: que verify-email reciba el idioma.

**Verificación:** desde el Preview, registro con Gmail y Outlook reales → el código llega a la bandeja de entrada, no a spam; "Mostrar original" da SPF, DKIM y DMARC `PASS`; restablecer contraseña también llega.

### 2.9 Stripe — código HECHO; **deshabilitado en la beta** (decisión del 23 oct)
Sin las variables `STRIPE_*` en Vercel, las rutas de Stripe responden 503 y el resto de la app funciona. Falta que el frontend oculte Premium/upgrade cuando la facturación está apagada (CLAUDE.md: un flag se aplica en frontend y backend). Lo de abajo queda para cuando se active.

#### Plan original (cuando se active)
Decisión del 21 oct (cierra la H): Stripe se configura **ya**, en el primer despliegue, no después. Hoy `server/lib/stripe.ts` crea el cliente al importar y tumba la app entera si falta `STRIPE_SECRET_KEY`. Tocar Stripe está en la lista de "no modificar sin preguntar" del CLAUDE.md: esta sección es esa pregunta, y su OK cubre **solo** lo que está aquí.

**Modo de Stripe durante la beta: test (sandbox)** en Preview y en Production (decisión I). El flujo completo funciona con tarjetas de prueba y nadie paga dinero real. Pasar a modo live al salir de la beta es cambiar las tres variables y crear el webhook live, sin tocar código.

**Tareas:**
1. **Tú, en el panel de Stripe** (en el modo que se decida): producto "LifePlan Premium" con su precio mensual → `STRIPE_PREMIUM_PRICE_ID`. Webhook a `https://budget.luisvespa.com/api/stripe/webhook` con los 5 eventos que maneja hoy `server/routes/stripe.ts`: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded` → `STRIPE_WEBHOOK_SECRET`. Preview usa otro endpoint de webhook (o ninguno, y se prueba con `stripe listen`), siempre en modo test.
2. **`server/lib/stripe.ts` perezoso:** el cliente se crea en la primera llamada; si falta la clave, las rutas de Stripe responden `503 { error }` en vez de que caiga la app. Igual con `STRIPE_PREMIUM_PRICE_ID`. Sin cambiar la lógica de checkout, webhook ni suscripciones.
3. **Revisar el webhook en Vercel:** necesita el cuerpo **crudo** para verificar la firma (`express.raw` en `server/app.ts:50`). Comprobar que la función de Vercel no lo parsea antes; si llega ya parseado, la verificación falla siempre con 400.
4. **Revisar el uso de la API:** `current_period_end` se lee de la suscripción (`server/routes/stripe.ts:48`); en versiones recientes de la API de Stripe ese campo vive en los items de la suscripción. Comprobar contra la `apiVersion` fijada en `stripe.ts` y que no se guarda `Invalid Date`.
5. **Portal de cliente:** decidir si se activa el Customer Portal de Stripe para cambiar tarjeta/cancelar o se sigue con las rutas propias (`cancel-subscription`, `reactivate-subscription`). Por defecto, las propias: ya existen.
6. **Tests:** sin red; el arranque de la app sin variables de Stripe no lanza; `syncSubscription` con un objeto de suscripción de ejemplo guarda bien estado y fechas.

**Verificación (en el Preview, modo test):** hacerse Premium con la tarjeta `4242 4242 4242 4242` → vuelve a Ajustes con Premium activo → llega el webhook (200 en el panel de Stripe) → llega el email "suscripción activada" por Cloudflare (2.8) → cancelar → queda "cancela al final del periodo" → reactivar. Con `4000 0000 0000 0341` (falla al cobrar), llega el email de pago fallido.

---

## Épica 3: onboarding desde cero — HECHA

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

## Épica 4: importación de ficheros de cuentas y tarjetas

**Por qué va antes que la conexión con bancos:** funciona sin contratos ni proveedor; cubre lo que PSD2 cubre peor en España (tarjetas de crédito, Wizink/Cetelem/Klarna, historial de más de 90 días, usuarios que no quieren conectar su banco); y construye el **núcleo de ingesta** que la épica 5 reutiliza, para que un movimiento importado y uno sincronizado se traten igual.

### Estado actual (verificado en el código, 28 oct)
- Funciona de punta a punta para **cuentas bancarias con cabeceras en español tipo BBVA** (.xlsx/.csv): previsualización, duplicados, categorías por reglas e IA, pagos a una partida de deuda, guarda `PAID_FROM_CARD`.
- **Un único parser** (`server/lib/parsers/bbva.ts`) para todos los ficheros. Revolut, N26 o cualquier cabecera en inglés fallan. No hay OFX, Norma 43 ni PDF.
- CSV frágil: no respeta campos entre comillas con el separador dentro y solo lee UTF-8 (muchas exportaciones españolas son Latin-1). `parseAmount` lee mal `1.234` (sin decimales) y `1,234.56` (formato inglés).
- **Tarjetas: no se importan bien.** Las compras sí suben la deuda, pero los abonos de la tarjeta ("pago recibido", devoluciones) se convierten en **ingresos**: inflan los ingresos y no bajan la deuda. Si el mismo pago se importa también desde la cuenta del banco, cuenta doble. Muchas tarjetas exportan las compras en positivo: hoy entrarían todas como ingresos.
- Duplicados: la huella no incluye la cuenta y, sin columna de saldo (típico de tarjetas), dos compras idénticas el mismo día se toman por una.
- Vercel limita el cuerpo de la petición a 4,5 MB: ficheros de más de ~3 MB fallan con 413.

### Etapa 1 — HECHA (rama `feature/importacion`, 29 oct; pendiente de `db push` y de probar en el navegador)
Núcleo y lectores en `server/lib/ingest/`, con tests; las rutas de importación ya los usan:
- **Lectores** (TypeScript puro, sin APIs de Node: la etapa 2 los ejecuta en el navegador, decisión O): CSV robusto (comillas, `;` `,` tab `|`, UTF-8/Windows-1252/UTF-16), XLSX (elige la hoja), Norma 43, OFX/QFX; números (`1.234`, `1,234.56`, `(12,34)`, `12,34-`…) a céntimos sin pasar por float; fechas a día natural (`yyyy-mm-dd`), sin zona horaria.
- **Columnas**: mapeo guardado de la cuenta → perfil de banco (BBVA; Revolut *pendiente de validar con un fichero real*) → sinónimos es/en. Si nada encaja: 422 `unrecognized_columns` con las primeras filas para el mapeo manual.
- **Núcleo** (`classify.ts`): cuenta vs. tarjeta, pago de tarjeta detectado por frase ("liquidación tarjeta", "recibo visa"…; nunca "pago con tarjeta") o por regla aprendida, mismo pago reconocido entre fichero del banco y de la tarjeta, devoluciones, signo de la tarjeta detectado. Huella por cuenta + nº de aparición sin saldo; ids antiguos reconocidos; "posible duplicado" solo avisa.
- **Devoluciones (L)**: `Expense.kind = "refund"`, importe positivo que cuenta negativo en `countedAmounts()` y en las compras de la deuda.
- **Revolut**: solo filas `COMPLETED` (pendientes, revertidas y rechazadas se listan como omitidas); la comisión es un gasto aparte; otra divisa se marca, no se convierte.
- **Mapeo manual**: `Account.importProfile` (Json) + `GET/PATCH /api/accounts/:id/import-profile` (solo el dueño).
- **Schema (aditivo, falta `db push`)**: `Expense.kind String @default("expense")`, `Account.importProfile Json?`.

Etapa 2: interfaz del asistente (4.6) con mapeo manual y conmutador de signo, leer el fichero en el navegador y enviar `rows`, UX de pagos de tarjeta (elegir tarjeta cuando hay varias, aprender la regla), mostrar devoluciones en Actividad, mapeo de columnas con IA, perfil de la PASS.

### 4.1 Núcleo de ingesta común (`server/lib/ingest/`)
Una sola función decide qué es cada movimiento, venga de un fichero (épica 4) o de un banco (épica 5):
- **Entrada normalizada:** fecha, importe en céntimos con signo **desde el punto de vista del titular**, descripción, comercio, saldo (opcional), referencia externa (opcional), cuenta destino.
- **Cuenta bancaria:** cargo → gasto en su categoría; abono → ingreso; **pago de tarjeta** detectado (4.4) → pago a la deuda de esa tarjeta (`debtId`), nunca gasto ni ingreso además.
- **Tarjeta:** compra → gasto en su categoría sobre la cuenta tarjeta (sube la deuda); **pago recibido** → baja la deuda, y si ese pago ya entró desde la cuenta del banco, se reconoce como el mismo y no cuenta dos veces; **devolución** → baja la deuda y el gasto de su categoría (modelo pendiente: decisión L).
- **Duplicados:** huella por cuenta (incluye `accountId`); sin columna de saldo, se distingue por orden de aparición dentro del día; y aviso de "posible duplicado" entre fuentes distintas (fichero vs. banco, o dos ficheros que se solapan) por importe ± fecha ± cuenta, que el usuario confirma en la previsualización.
- Respeta las reglas del CLAUDE.md: todo en céntimos enteros; las sumas de gasto siguen pasando por `countedAmounts()` / `budgetAmount`.
- **Tests de dinero obligatorios:** compra de 50 € con tarjeta + pago de la tarjeta desde el banco de 350 € → gasto del mes 350 (el caso 6 de la épica 3), también cuando el pago llega por los dos ficheros.

### 4.2 Lectura de ficheros
- **CSV robusto:** comillas, separador `;` `,` o tabulador, detección de codificación (UTF-8 / Latin-1 / UTF-16 de algunos bancos).
- **XLSX:** elegir la hoja con movimientos si hay varias.
- **Norma 43 (AEB/CSB 43):** el formato estándar de extractos de la banca española; lo exportan casi todos los bancos desde la banca online de empresa y muchos de particulares. Un parser lo cubre para todos.
- **OFX/QFX:** lo exportan ING, Openbank y varias tarjetas.
- **Detección de columnas:** sinónimos de cabecera en español e inglés + **perfiles por banco** (BBVA, Santander, CaixaBank, Sabadell, Bankinter, ING, Openbank, Revolut, N26, Wise, y emisores de tarjetas). Cada perfil con su fichero de ejemplo **anonimizado** como test.
- **Mapeo manual cuando no se reconoce:** el usuario elige columna de fecha, importe (o debe/haber por separado), descripción, formato de fecha y si las compras vienen en positivo. Se guarda como perfil de esa cuenta: la segunda vez se importa sin preguntar.
- **Números y fechas:** arreglar `1.234` y `1,234.56`; fechas `dd/mm/aaaa`, `dd-mm-aa`, ISO y fechas de Excel; tests para cada caso.
- **PDF:** fuera de esta épica (decisión N).

### 4.3 Modo tarjeta
Cuando la cuenta destino es una tarjeta:
- Convención de signo explícita ("las compras aparecen en positivo / en negativo"), detectada si se puede y confirmable.
- Reconoce las líneas de **pago recibido** y **devolución** y las trata como en 4.1.
- Si el fichero trae fecha de corte o periodo, se guarda: es la base del **ciclo de facturación (1.9)** ("lo que vence este mes" vs. "saldo total").
- Opcional: comparar el total importado con el importe del extracto que dice el usuario, y avisar si no cuadra.

### 4.4 Detección automática de pagos de tarjeta
En los ficheros de la cuenta bancaria, reconocer el cargo con que se paga una tarjeta ("LIQUIDACION TARJETA", "PAGO TARJETA", "RECIBO VISA", últimos 4 dígitos, el nombre del emisor…) y proponerlo como pago a la deuda de esa tarjeta, en vez de dejarlo como gasto sin categoría (hoy cuenta doble si no hay una regla aprendida). Lo mismo para cuotas de préstamos y BNPL ya dados de alta en Deudas. El usuario confirma en la previsualización y la regla se aprende.

### 4.5 Ficheros grandes
Para pasar del límite de 4,5 MB: leer el fichero en el navegador y enviar al servidor solo las filas (JSON mucho más pequeño), o subir el fichero a Vercel Blob y leerlo desde el servidor. Decidir al llegar (decisión O); con extractos mensuales normales no hace falta.

### 4.6 Interfaz
Asistente: cuenta → fichero → (mapeo, solo si no se reconoce) → previsualización (categorías, duplicados, pagos de tarjeta detectados, avisos) → confirmar → resumen ("23 gastos, 2 ingresos, 1 pago a la tarjeta PASS"). Errores claros y en español cuando un fichero no se entiende, con la opción de mapear a mano. Textos en `es.json` y `en.json`.

### 4.7 Lo que necesito de ti
- **Bancos y tarjetas de la beta (28 oct): BBVA (cuenta), Revolut (cuenta) y tarjeta de crédito PASS de Carrefour.** Son los primeros perfiles, en este orden:
  1. **BBVA**: el único que ya funciona hoy; añadir su fichero real como test y revisar los casos que fallan (números, duplicados sin saldo).
  2. **Revolut**: CSV/Excel con cabeceras en inglés y formato de número inglés; columnas propias (comisión aparte del importe, estado `COMPLETED`/`PENDING`/`REVERTED`, tipo de operación, cambio de divisa). Hoy no se puede importar.
  3. **PASS Carrefour**: tarjeta de crédito (modo tarjeta, 4.3). Formato de exportación **por confirmar** con tu fichero: si su área de cliente solo da PDF, se replantea la decisión N.
- **Un fichero de ejemplo de cada uno** (cuenta y tarjeta), del formato que dé su banca online. Los anonimizo antes de usarlos como test (nombres, IBAN, importes) y no se suben al repo sin anonimizar.

### 4.8 Verificación
Con tus ficheros reales de un mismo mes, en local y luego en producción: importar el extracto de la cuenta y el de la tarjeta → el gasto del mes cuadra con lo real (sin dobles), la deuda de la tarjeta coincide con el extracto, el pago de la tarjeta aparece una sola vez como pago a la deuda; reimportar el mismo fichero no crea nada nuevo.

---

## Épica 5: conexión con bancos (PSD2)

### Situación del mercado (investigado el 28 oct 2026, con fuentes oficiales)
- **GoCardless Bank Account Data (antes Nordigen) no acepta clientes nuevos desde julio de 2025.** El código que tenemos es solo para GoCardless: no se puede usar.
- **Ya no hay ruta gratuita y autoservicio:** todos los proveedores que aceptan clientes piden empresa (o autónomo, por confirmar), verificación (KYB) y contrato para conectar cuentas de otras personas.
- **Proveedor propuesto (decisión M, pendiente de tu OK): Enable Banking.** Sus usuarios operan bajo su licencia AISP (no necesitas licencia propia), consentimientos de ~180 días, la mejor documentación de bancos españoles vía Redsys, y un **modo restringido gratuito para tus propias cuentas**: se puede construir y probar entero sin contrato. Precio de producción por cuenta y mes con **mínimo mensual** (sin cifras públicas). Alternativa: Plaid EU (gratis 200 llamadas por producto: unos pocos usuarios), Tink o Salt Edge (por ventas).
- **Tarjetas de crédito por PSD2 en España: no confirmado** con ningún proveedor. Por eso la épica 4 va primero.
- Límites: renovar el consentimiento cada ~180 días; ~4 actualizaciones al día por cuenta sin el usuario delante.

**Antes de la beta con otros usuarios (tú):** escribir a Enable Banking (info@enablebanking.com) y preguntar: mínimo mensual, si firman con un autónomo, y si cubren cuentas de tarjeta de crédito en bancos españoles.

### Estado actual del código (verificado, 28 oct)
Un 70 % construido para GoCardless y nunca ejecutado: lista de bancos, consentimiento con `state` firmado, callback, vinculación de cuentas, sincronización manual, `sync-all`, detección de consentimiento caducado. Problemas: la sesión post-consentimiento vive en un `Map` en memoria (falla en Vercel, igual que pasó con Google); `sync-all` espera POST + `x-cron-secret` (Vercel Cron manda GET + `Authorization: Bearer`) y no hay cron configurado; al vincular una tarjeta **no** se crea su deuda y se sobrescribe su saldo (rompe el patrimonio y los ingresos); los movimientos sincronizados y los importados de la misma cuenta se duplican; no hay categorización por IA ni reparto por hogar en la sincronización; el frontend no muestra los errores `banking_*`.

### 5.1 Proveedor Enable Banking
- **Aplicación creada el 29 oct** en Enable Banking (producción, modo restringido): ID `ac678122-3430-4b6b-bb66-2403c9c446e8` (no es secreto). **Activa desde el 29 oct**: Luis vinculó su cuenta de **BBVA** (Revolut todavía no). Sin confirmar si BBVA expone tarjetas de crédito por esta vía ni si Carrefour PASS aparece en la lista de bancos. Redirect URLs registradas: `https://budget.luisvespa.com/api/banking/callback` y `http://localhost:3002/api/banking/callback`; privacidad y términos en `/privacy` y `/terms`. La clave privada `.pem` la guarda Luis fuera del repo; nunca pasa por Claude.
- Implementar `BankingProviderClient` (`server/lib/banking/types.ts` ya es neutral) para Enable Banking: autenticación con JWT firmado con la clave privada de la app (variable de entorno; nunca en el repo), lista de bancos de España, inicio de autorización, sesión, cuentas (con detalles: nombre, IBAN enmascarado, tipo), saldos y movimientos (contabilizados y, aparte, pendientes).
- **Quitar el cliente de GoCardless** (decisión P): no se puede contratar y deja código muerto.
- El identificador de sesión del proveedor se guarda **cifrado** con `secretBox` (`ENCRYPTION_KEY`), que ya existe y hoy nadie usa.

### 5.2 Que funcione en Vercel
- La sesión post-consentimiento: JWT firmado de corta duración, como el arreglo de Google (sin `Map` en memoria).
- Sincronización periódica con **Vercel Cron** (GET + `Authorization: Bearer CRON_SECRET`), por lotes con presupuesto de tiempo, respetando ~4 al día por cuenta.

### 5.3 Cuentas y tarjetas vinculadas
- Vincular una cuenta de tarjeta del banco = crear o elegir la **cuenta tarjeta + su deuda** (`cardDebt.ts`), y enlazar también la deuda (`Debt.bankConnectionId` / `externalAccountId`) para que el saldo del banco se concilie con un `DebtAdjustment` fechado (ya implementado en `setLiveValues`, hoy nunca se llama).
- Nunca sobrescribir el saldo de una cuenta tarjeta (debe seguir en 0; lo que se debe vive en la deuda).

### 5.4 Movimientos por el núcleo de la épica 4
Toda la sincronización pasa por `server/lib/ingest/`: mismas reglas de tarjeta, mismos duplicados (incluido el aviso entre fichero importado y banco), detección de pagos de tarjeta, reparto por hogar, y categorización por reglas + IA opcional.

### 5.5 Primera sincronización con revisión
El frontend usa los endpoints de previsualización que ya existen: la primera vez el usuario revisa y confirma, en vez de importar 90 días a ciegas.

### 5.6 Interfaz y avisos
- "Conecta tu banco" en Cuentas (y opcional en el onboarding, paso 3).
- Errores del consentimiento visibles (`?error=banking_*`), estado de cada conexión, botón de reconectar.
- **Aviso antes de caducar el consentimiento** (en la app y por email con una plantilla nueva del módulo de email), guardando `expiresAt` (hoy nunca se escribe).

### 5.7 Interruptor en servidor y frontend
Activo solo con las variables de Enable Banking. Mientras estemos en modo restringido (solo tus cuentas), además una lista de emails permitidos (`BANKING_ALLOWED_EMAILS`) para que los beta testers no vean un botón que fallaría.

### 5.8 Privacidad
Borrar una conexión revoca el consentimiento en el proveedor y deja de sincronizar; los movimientos ya importados se quedan (son del usuario). Añadir a la política de privacidad qué datos se leen y quién es el proveedor con licencia.

### 5.9 Verificación
En modo restringido, con tus cuentas reales: conectar banco → revisar y confirmar la primera sincronización → la cuenta y (si el banco la expone) la tarjeta aparecen con su deuda; al día siguiente el cron trae lo nuevo sin duplicar lo importado por fichero; desconectar revoca el acceso. Usuarios beta solo después del contrato.

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

**G.** ~~Open Banking en producción~~ → decidido 21 oct: apagado por ahora; será una fase futura del proyecto.

**H.** ~~¿Stripe perezoso o configurado desde el principio?~~ → decidido 21 oct: configurado desde la beta, y además perezoso para que su ausencia no tumbe la app (2.9).

**I.** ~~Stripe durante la beta~~ → decidido 21 oct: modo test; **cambiado el 23 oct: deshabilitado en la beta**. Cuando se active: modo test primero. Al pasar a live: precio definitivo y textos legales mínimos (términos, privacidad, política de cancelación) antes de cobrar.

**J.** ~~Remitente de los emails~~ → decidido 21 oct: **`contact@luisvespa.com`** (también dirección de soporte y Reply-To).

**K.** ~~Proveedor de email~~ → decidido 23 oct: **Resend** en la beta, con módulo independiente del proveedor; Cloudflare cuando se acerque al límite de 100/día.

**L.** ~~Devoluciones de la tarjeta~~ → decidido 29 oct: **gasto marcado como devolución** (campo de tipo en `Expense`, schema aditivo aprobado). Contexto (4.1): cómo se modelan para que bajen a la vez la deuda y el gasto de su categoría. Hoy los importes de `Expense` son siempre positivos y el saldo de la deuda solo lee gastos, pagos y ajustes. Opciones: un gasto con importe negativo marcado como devolución, o un campo de tipo en `Expense`. Puede necesitar un cambio de schema: se propone antes de aplicarlo.

**M.** ~~Proveedor de Open Banking~~ → decidido 29 oct: **Enable Banking** (GoCardless cerrado a clientes nuevos desde julio de 2025). Construir en modo restringido con tus cuentas; usuarios reales tras el contrato. Pendiente de tu OK y de la respuesta de Enable Banking (mínimo mensual, autónomo, tarjetas en España).

**N.** Importar PDF: fuera de la épica 4. La mayoría de bancos exportan CSV/XLSX/Norma 43/OFX; el PDF es frágil y caro de mantener. Se revisa si algún banco o tarjeta importante solo da PDF.

**O.** ~~Ficheros de más de ~3 MB (4.5)~~ → decidido 29 oct: **se leen en el navegador** y solo se envían las filas; sin Vercel Blob.

**P.** ~~Quitar GoCardless~~ → decidido 29 oct: **se quita** al empezar la épica 5.

**Q.** ~~Stripe~~ → decidido 28 oct: **futuro lejano; la app es gratuita**.

**R.** Autorizaciones del 29 oct para trabajar en autónomo:
- **Schema:** cambios aditivos (columnas o tablas nuevas, sin borrar ni renombrar) aplicados en local con `db push` sin preguntar. Lo que borre o renombre se sigue preguntando.
- **Finanzas compartidas (pendiente 10):** al aceptar, todo lo que la invitada creó en su onboarding pasa al pool compartido a su nombre; cuentas y deudas compartidas con el hogar ("household").
- **Épica 5:** se puede tocar el código de conexión con bancos.
- **Ritmo:** un PR por bloque (mantenimiento, épica 4, épica 5). Claude sube la rama y da el comando del PR; Luis fusiona, despliega y hace el `db push` de producción.
