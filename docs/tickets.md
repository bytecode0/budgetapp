# Tickets de LifePlan

Backlog de tickets refinados. **Ninguno se implementa hasta que Luis lo pida**, y el orden lo decide él.
Contexto general y épicas ya hechas: [`plan-deudas-y-onboarding.md`](plan-deudas-y-onboarding.md).

| # | Ticket | Estado | Schema |
|---|---|---|---|
| LPBETA-01 | Ciclo de facturación de la tarjeta | Refinado (plan 1.9) | No |
| LPBETA-02 | Gráficas de deudas, detalle y plan de pago | Refinado | No |
| LPBETA-03 | Stripe y control de acceso Premium | Refinado | No |
| LPBETA-04 | Pequeños pendientes | **Hecho y desplegado** (PR #14, 4 nov). Incluye `npm run backfill:legacy-owners`: Luis lo ejecuta en su terminal, primero sin `--apply` | — |
| LPBETA-05 | Medir usuarios activos | **Hecho y desplegado** (PR #8, 4 nov) | Sí (aditivo: `User.lastBankReviewAt`, `PlanDeposit.byUserId`) |
| LPBETA-06 | Remanso no asesora sobre inversiones (simulador con aviso) | **Hecho y desplegado** (PR #13, 4 nov) | No |
| LPBETA-07 | Inicio y onboarding para el nuevo cliente | Refinado — **va antes de la BETA** | Por confirmar al diseñar |
| LPBETA-08 | Enlace de invitación para amigos | Aplazado (después de la BETA) | Sí (aditivo) |
| LPBETA-09 | Borrar la cuenta, exportar los datos y promesa de privacidad | Refinado — **bloquea la BETA** | Sí (aditivo) |
| LPBETA-10 | Línea de generosidad en el onboarding | Refinado | No |
| LPBETA-11 | Instalable en el móvil (PWA) y página de bienvenida | **Hecho y desplegado** (PR #16, 4 nov). Bienvenida pública; PWA sin service worker. Falta probar en un móvil real: login con Google y vuelta del banco desde la app instalada | No |
| LPBETA-12 | Detección de suscripciones y gastos hormiga | Refinado | Sí (aditivo, pequeño) |
| LPBETA-13 | Celebrar los hitos | En refinamiento | Probablemente sí (aditivo, solo "ya visto") |
| LPBETA-14 | Seguridad del acceso (códigos y contraseñas) | **Hecho y desplegado** (PR #7, 4 nov) | Sí (aditivo, aplicado en el schema) |
| LPBETA-15 | Robo de cuenta preparado de antemano (registro + Google) | En revisión (`feature/seguridad-alta`). **Espera el `db push` de `RateLimitHit` de Luis** | No |
| LPBETA-16 | Límite al envío de códigos por email | En revisión (`feature/seguridad-alta`). **Espera el `db push` de `RateLimitHit` de Luis** | Sí (aditivo: tabla `RateLimitHit`) |
| LPBETA-17 | Límite de uso de la IA (coste) | En revisión (`feature/seguridad-alta`). **Espera el `db push` de `RateLimitHit` de Luis** | No (usa la tabla del 16) |
| LPBETA-18 | Salir del hogar no quita el acceso a los datos de la pareja | **Hecho y desplegado** (PR #20, 4 nov). Decidido 4 nov: lo privado de un miembro se oculta a la pareja en todos los niveles (también el transparente); los totales lo cuentan como "Compromisos privados de tu pareja" | No |
| LPBETA-19 | Las deudas y cuentas privadas se ven y se modifican desde la pareja | **Hecho y desplegado** (PR #20, 4 nov). Decidido 4 nov: lo privado de un miembro se oculta a la pareja en todos los niveles (también el transparente); los totales lo cuentan como "Compromisos privados de tu pareja" | No |
| LPBETA-20 | La invitación de pareja no está ligada al email invitado | **Hecho y desplegado** (PR #20, 4 nov). Decidido 4 nov: lo privado de un miembro se oculta a la pareja en todos los niveles (también el transparente); los totales lo cuentan como "Compromisos privados de tu pareja" | No |
| LPBETA-21 | Cerrar todas las sesiones (sesiones revocables) | Refinado — Media | Sí (aditivo, un campo) |
| LPBETA-22 | Dependencias con vulnerabilidades conocidas | **Hecho y desplegado** (PR #18, 4 nov) | No |
| LPBETA-23 | Endurecimiento menor de seguridad | Refinado — Baja | No |
| LPBETA-24 | Medir la paz: una pregunta al mes | En refinamiento | Sí (aditivo: una tabla pequeña) |
| LPBETA-25 | Dominio de la BETA: `app.luisvespa.com` | Refinado — decidido el 4 nov | No |
| LPBETA-26 | Nuevo nombre de la app: **Remanso** | **Hecho y desplegado** (PR #10, 4 nov). Falta buscar la marca en la OEPM/EUIPO y que Luis cambie `EMAIL_FROM` en Vercel | No |
| LPBETA-27 | Rediseño de toda la app para Remanso | Fase 1 hecha y desplegada (PR #9). Fase 2: Actividad (PR #12), Deudas (PR #15) y Planes (PR #19) en revisión; faltan Cuentas, Partidas, Hogar y Ajustes | No |

### Orden de ejecución (4 nov, sustituye al de abajo)

**Cambio del 4 nov (auditoría de seguridad):** se añaden LPBETA-15 a LPBETA-23. Prioridad según la gravedad: **Alta** = un atacante puede entrar en una cuenta ajena o gastar dinero de LifePlan; **Media** = un miembro de la pareja ve o cambia lo que no debe, o hace falta para responder a un robo de sesión; **Baja** = endurecimiento sin un ataque directo hoy. La auditoría no encontró forma de entrar sin credenciales ni de leer los datos de otro hogar: los huecos están en el registro, en los límites de uso y en la privacidad dentro de la pareja.

**Decisión de Luis (4 nov):** todos los tickets se implementan **antes de la primera ola de amigos**. Ya no hay bloques "durante" y "después" de la BETA: el orden solo sirve para no hacer el mismo trabajo dos veces. *Por confirmar:* si "todos" incluye LPBETA-03 (Stripe, que Luis quería de los últimos) y LPBETA-08 (invitaciones con descuento, que depende de 03).

Reparto (4 nov): la sesión de **rebranding** hace 24–27; la **otra sesión** hace el resto, cada ticket en su rama y su PR. Las dos se avisan antes de tocar un fichero compartido.

| # | Ticket | Quién | Estado / por qué aquí |
|---|---|---|---|
| ✓ | LPBETA-14 · Seguridad del acceso | rebranding | Hecho y desplegado (PR #7). |
| ✓ | LPBETA-05 · Medir usuarios activos | otra | Hecho y desplegado (PR #8). |
| ✓ | LPBETA-27 · Rediseño, fase 1 (sistema de diseño, modo claro/oscuro) | rebranding | Hecho y desplegado (PR #9). |
| ✓ | LPBETA-26 · Nombre Remanso y logo | rebranding | Hecho y desplegado (PR #10). Falta buscar la marca en la OEPM/EUIPO. |
| ✓ | LPBETA-04 · Pequeños pendientes | otra | Hecho y desplegado (PR #14). |
| 3 | LPBETA-15, 16, 17 · Seguridad ALTA | otra | En revisión; espera el `db push` de Luis. Antes de invitar a nadie. |
| 4 | LPBETA-09 · Borrar cuenta, exportar y privacidad | otra | Confianza y RGPD. |
| ✓ | LPBETA-06 · Aviso de inversiones | otra | Hecho y desplegado (PR #13). |
| ✓ | LPBETA-18 · Seguridad MEDIA (salir del hogar) | otra | Hecho y desplegado con 19 y 20 (PR #20). |
| 7 | LPBETA-25 · Dominio `app.luisvespa.com` | rebranding + Luis | Los paneles los hace Luis; los textos, Claude. |
| 8 | LPBETA-07 · Inicio y onboarding | otra | Con el diseño nuevo (pautas de `CLAUDE.md`), después de fusionar el 26. |
| 9 | LPBETA-10 · Generosidad | otra | El mismo flujo de onboarding que el 07. |
| 10 | LPBETA-24 · Medir la paz | rebranding | Una tarjeta en el Inicio nuevo, después del 07. |
| ✓ | LPBETA-11 · PWA y bienvenida | otra | Hecho y desplegado (PR #16). Falta probarla en un móvil real. |
| 12 | LPBETA-27 · Rediseño, fase 2 (pantallas sin ticket propio) | rebranding | Actividad (PR #12), Deudas (PR #15) y Planes (PR #19) en revisión. Después: Cuentas, Partidas (tras el 07), Hogar y Ajustes (tras el 09). |
| 13 | LPBETA-19 a 23 · Seguridad MEDIA y BAJA | otra | 19, 20 (PR #20) y 22 (PR #18) hechos y desplegados; 21 y 23 pendientes. |
| 14 | LPBETA-12 · Suscripciones y gastos hormiga | otra | Pantallas nuevas, ya con el diseño nuevo. |
| 15 | LPBETA-13 · Celebrar los hitos | otra | Ídem. |
| 16 | LPBETA-02 · Gráficas de deudas | otra | Ídem. |
| 17 | LPBETA-01 · Ciclo de facturación de la tarjeta | otra | Sobre todo servidor. |
| 18 | LPBETA-08 · Invitación | otra | Si entra. |
| 19 | LPBETA-03 · Stripe y Premium | otra | El último, como pidió Luis, si entra. |

**Renumeración (4 nov, decisión de Luis):** los tickets de seguridad de la auditoría conservan LPBETA-15 a 23. Los de marca pasan a **24** (paz, antes 15), **25** (dominio, antes 16), **26** (Remanso, antes 17) y **27** (rediseño, antes 18). Los commits y PR anteriores al 4 nov por la tarde (PR #9 y #10) los citan con el número antiguo.

### Orden anterior (con la BETA por olas; sustituido el 4 nov)

Situación: la alfa está desplegada en `budget.luisvespa.com` con 2 usuarios. Tamaño: S = un día o menos, M = 2–3 días, L = una semana.

**Cambio del 4 nov:** todavía no hay taller. Luis invitará uno a uno a amigos que vea que necesitan la app. Por eso no hay fecha fija: los amigos entran poco a poco y la app tiene que entenderse **sola**, sin nadie al lado. Eso sube la importancia del 07 (el mensaje del onboarding) y del 11 (la página que ve quien recibe el enlace por WhatsApp).

**Puerta para invitar al primer amigo: 14 + 05 + 09 + 07** (medir, confianza y un mensaje que se entienda solo). El resto del bloque A puede llegar mientras los primeros amigos ya la usan.

**A. Antes de invitar a los amigos (por olas, sin fecha fija)**
| # | Ticket | Tamaño | Por qué va aquí |
|---|---|---|---|
| 0 | **LPBETA-14 · Seguridad del acceso (códigos y contraseñas)** | S–M | **Urgente, antes de invitar a nadie:** el sistema es público y hoy se puede adivinar el código de recuperación de contraseña de otra persona. Ya afecta a la alfa desplegada. |
| 1 | LPBETA-05 · Medir usuarios activos | S | Sin medir, la BETA no enseña nada. Con 2 usuarios ya da la línea base y prueba el script antes de que haya 20. Solo lectura, sin schema. |
| 2 | LPBETA-04 · Pequeños pendientes | S | Sobre todo el `/deploy` del `db push` de producción: lo necesitan los siguientes tickets que cambian el schema (09, 12, 13). |
| 3 | LPBETA-09 · Borrar cuenta, exportar y privacidad | M–L | Bloquea la BETA: RGPD y la primera duda en una comunidad donde todos se conocen. Toca la autenticación. |
| 4 | LPBETA-06 · Aviso de inversiones | S | Riesgo regulatorio y todo decidido: tasas 3,5/5/7 % y aviso. Rápido. |
| 5 | LPBETA-07 · Inicio y onboarding para el nuevo cliente | L | El mensaje del nuevo cliente. Sin taller, el onboarding tiene que explicarse solo. |
| 6 | LPBETA-10 · Generosidad en el onboarding | S | Justo después del 07 y en la misma línea de trabajo: los dos cambian el onboarding. |
| 7 | LPBETA-11 · PWA y página de bienvenida | S–M | El amigo recibe un enlace por WhatsApp: necesita ver qué es antes de registrarse, y luego instalarla solo. Faltan respuestas de Luis (logo, página pública o solo con enlace). |

**B. Durante la BETA (de finales de noviembre a diciembre)**
| # | Ticket | Tamaño | Por qué va aquí |
|---|---|---|---|
| 8 | LPBETA-12 · Suscripciones y gastos hormiga | M–L | Decidido "para la BETA". Necesita unas semanas de movimientos para detectar algo, así que llega bien a las 2–3 semanas de uso. |
| 9 | LPBETA-13 · Celebrar los hitos | M | Retención y testimonios. Tiene más sentido cuando ya hay un mes de aportaciones. Faltan respuestas de Luis. |

**C. Después de la BETA**
| # | Ticket | Tamaño | Por qué va aquí |
|---|---|---|---|
| 10 | LPBETA-02 · Gráficas de deudas y plan de pago | L | Valioso, pero el nuevo cliente no tiene la deuda como eje. Se prioriza según lo que pida la BETA. |
| 11 | LPBETA-01 · Ciclo de facturación de la tarjeta | M | Precisión para quien usa tarjeta revolving. El mismo criterio que el 02. |
| 12 | LPBETA-03 · Stripe y Premium | M | Decisión de Luis: de los últimos. No se cobra antes de la etapa 2, y antes hacen falta Vercel Pro y lo legal. |
| 13 | LPBETA-08 · Enlace de invitación | M | Aplazado hasta después de la BETA. Su recompensa (descuento en Premium) depende del 03, por eso va detrás. |

**El bloque B** empieza cuando haya unas semanas de uso real (el 12 necesita movimientos para detectar algo), no en una fecha.

Luis decide cuándo se ejecuta cada uno.

---

## LPBETA-01 · Ciclo de facturación de la tarjeta — REFINADO

Con `statementDay` / `paymentDueDay` de la tarjeta, separar **lo que vence este mes** (compras hasta el día de corte) del **saldo total** (incluye compras después del corte, que se pagan el mes siguiente). Es el diferenciador de "dos ejes de tiempo" del producto. El modelo actual lo permite sin cambiar el schema (saldo derivado, `server/lib/debtBalance.ts`). Detalle original en el plan, sección 1.9.

---

## LPBETA-02 · Gráficas de deudas, detalle y plan de pago — REFINADO

Petición de Luis: ver con gráficas cuánto falta para cancelar cada deuda, lo pagado y lo que resta; un simulador de pago extra; y el plan de pago (bola de nieve / avalancha) en su propia pantalla, con la gráfica de salida de deuda que cambia según el método elegido.

### Lo que ya existe (verificado en el código, 3 nov)
- `server/lib/debtPayoff.ts`: `simulatePayoff(debts, method, extraCents)` simula bola de nieve y avalancha con pago extra mensual, y devuelve solo un **resumen**: meses, intereses, total pagado y el mes en que se cierra cada deuda. No devuelve la serie mes a mes, que es lo que necesita una gráfica.
- `GET /api/debts/payoff?extra=` compara los dos métodos con saldos vivos (`owedNow`). La tarjeta en modo contado usa su saldo entero como mínimo.
- `Debts.tsx` tiene ya el bloque "plan de pago" con el campo de pago extra y las dos tarjetas comparativas. No hay gráfica ni pantalla de detalle, y el método elegido no se guarda.
- `GET /api/debts/timeline`: el "futuro comprometido" por periodo.
- `recharts` 2.15.2 ya está instalado.
- Lo pagado sale de los pagos registrados contra la deuda (el saldo es derivado, `debtBalance.ts`). `Debt.principal` (lo prestado al inicio) es opcional y muchas deudas no lo tendrán.

### Propuesta
**LPBETA-02.1 Motor: serie mes a mes.** Ampliar `simulatePayoff` (o una función hermana) para que devuelva, por mes, el saldo de cada deuda, lo pagado y los intereses. Puro, en céntimos, con tests. De ahí salen todas las gráficas y el simulador. También un **pago único** (p. ej. la paga extra de junio o diciembre) además del extra mensual.

**LPBETA-02.2 Pantalla de detalle de una deuda** (se abre al tocar una deuda en la lista):
- Cabecera: saldo actual, fecha estimada de fin y "te quedan N meses".
- Barra o anillo: pagado / resta / intereses que faltan por pagar.
- Gráfica de saldo en el tiempo: lo real hasta hoy (de los pagos) en línea continua y la proyección en discontinua hasta cero.
- Simulador: pago extra mensual y pago único → "terminas en X en vez de Y, ahorras N meses e Z de intereses". Se recalcula al momento. **Solo para mirar** (decisión del 3 nov): no guarda nada ni cambia el presupuesto.
- Historial de pagos y compras (hoy en 1.6 como pendiente).

**LPBETA-02.3 Pantalla del plan de pago** (sale de Deudas a su propia pantalla):
- Selector bola de nieve / avalancha: la gráfica se actualiza al cambiarlo. No se guarda (decisión del 3 nov).
- Pago extra mensual.
- Gráfica de áreas apiladas: el saldo de cada deuda en su color hasta llegar a cero, con la **fecha de libertad** marcada.
- Lista en el orden del método con la fecha de cierre de cada deuda.
- Comparación en una línea: "Con avalancha terminas N meses antes y ahorras X".

### Sugerencias de Claude (para decidir)
- **Futuro comprometido a lo largo del plan:** una gráfica del % de ingresos comprometido bajando a medida que se cierran deudas. Une este ticket con la métrica central del producto.
- **Fecha de libertad en Inicio**, que abre la pantalla del plan.
- **"Solo mínimos" como referencia** en la gráfica del plan, para que se vea lo que se gana con el plan.
- **Hitos:** marcar en la gráfica cuándo cae cada deuda ("aquí se libera tu cuota de 50 €").
- Más adelante: "aplicar" el pago extra del simulador al presupuesto como partida.

### Riesgos que hay que resolver en el diseño
- **Deudas sin TAE o sin mínimo:** la simulación no converge (tope de 600 meses) o la avalancha se vuelve igual que la bola de nieve. Pedir el dato en la propia pantalla en vez de mostrar una fecha falsa.
- **Tarjetas:** la proyección supone que no hay compras nuevas. Decirlo en la pantalla. Una tarjeta en modo contado no es deuda que proyectar.
- **Lo pagado sin `principal`:** "pagado" = pagos registrados desde que la deuda está en la app, no desde que se pidió el préstamo.
- **Hogar:** las deudas de la pareja entran según su visibilidad, igual que hoy en `/payoff`.

### Schema
Ninguno: el simulador es solo para mirar (decisión del 3 nov). Si más adelante se quiere guardar el método o el extra, sería aditivo (p. ej. `UserSettings.payoffMethod`) y se propone antes.

### Preguntas abiertas para Luis
1. ~~¿Pago único además del extra mensual?~~ → decidido 3 nov: **sí, las dos opciones** en el simulador.
2. ~~¿Guardar el método y el extra?~~ → decidido 3 nov: **el simulador es solo para mirar**; no se guarda nada.
3. ~~¿Alguna parte será Premium?~~ → decidido 3 nov: **no**. Premium será solo la conexión con bancos y el botón de importar ficheros; las gráficas y el simulador son gratis.
4. ~~¿Antes o después del ciclo de facturación?~~ → el orden lo decide Luis al pedir la ejecución. Nota: con LPBETA-01 hecho, las fechas de las tarjetas salen más exactas.

---

## LPBETA-03 · Stripe y control de acceso Premium — REFINADO

Petición de Luis: habilitar el botón Premium y poner control de acceso a importar. Premium incluirá **solo la conexión con bancos y el botón de importar ficheros** (decisión del 3 nov). Tocar Stripe está en "no modificar sin preguntar": este refinamiento es esa pregunta.

**Sin entorno de preproducción (decisión del 3 nov):** `budget.luisvespa.com` hace de preproducción mientras solo la usan la familia de Luis y algunos amigos. Cuando haya usuarios que paguen se revisa si hace falta separar entornos.

### Lo que ya existe (verificado en el código, 3 nov)
- Stripe ya está programado (2.9): checkout, confirmación, cancelar/reactivar, cambiar tarjeta, webhook y emails de suscripción. Es perezoso: sin `STRIPE_*`, sus rutas responden 503 y `useBillingEnabled` oculta Premium en el frontend.
- `Subscription.plan` (`free` | `premium`) en el schema.
- `bankingAccess()` (`server/lib/banking/config.ts`) ya devuelve un motivo y está preparado para añadir `premium_required`. La importación de ficheros no tiene ningún control de acceso todavía.

### LPBETA-03.0 Planes de suscripción (decididos el 3 nov; precios aprobados por Luis el 3 nov)
- **Compartir el hogar con la pareja sigue siendo gratis.**
- **Premium solo habilita la conexión con bancos y la importación con IA.** La versión gratis es completa; se cobra por comodidad y por el coste de la IA y de las conexiones.
- **Hogar es más caro** porque son más personas y más cuentas bancarias.
- **Solo pago anual y barato:** convierte menos, pero ingresa más por usuario cuando se cobre de verdad. Quien no llega a fin de mes tiene la versión gratis.

| Plan | Para quién | Incluye | Precio propuesto |
|---|---|---|---|
| **Gratis** | 1 persona (puede compartir hogar) | Todo menos banca e importar | 0 |
| **Premium** | 1 persona | + conexión con bancos + importar con IA | **24 €/año** (2 €/mes) |
| **Hogar** | los 2 miembros del hogar | Premium para los dos | **36 €/año** (3 €/mes; 12 € menos que dos Premium) |

**Por qué esos precios (mercado, búsqueda del 3 nov, fuentes de terceros):** las apps estadounidenses con banca cuestan ~95–110 $/año (YNAB 109 $, Monarch 99,99 $, Copilot 95 $); las europeas de control de gastos, ~15–36 €/año (Spendee Premium con banca ~36 $/año, Wallet ~18–20 £/año). 24 € queda por debajo de casi todas las europeas con banca y a un cuarto de las americanas: "menos que un café al mes". **Oferta de lanzamiento:** "precio de fundador" que se mantiene mientras siga suscrito.
**A revisar con la respuesta de Enable Banking:** si cobran por conexión al mes, comprobar que 24 €/36 € al año lo cubren. La comisión de Stripe en 24 € es ~0,60 €.

**Impacto en el código (hoy hay un solo precio):**
- `server/lib/stripe.ts` solo conoce `STRIPE_PREMIUM_PRICE_ID` y traduce el precio a `plan: "premium"`. Hace falta un segundo precio (`STRIPE_HOUSEHOLD_PRICE_ID`, variable nueva) y el valor `plan: "household"`. `Subscription.plan` es texto, así que **no cambia el schema**.
- El control de acceso (LPBETA-03.2) mira también al hogar: un miembro tiene Premium si su suscripción es Premium **o** si alguien de su hogar tiene Hogar.
- Pasar de Premium a Hogar a mitad de año: Stripe prorratea; decidir si se permite desde la app.
- Textos y emails dicen "al año"; cancelar deja el acceso hasta el final del año pagado.

**Familia y amigos: gratis para siempre** (decisión del 3 nov), porque `budget.luisvespa.com` es el entorno de preproducción; el cobro real será en un entorno de producción futuro. Propuesta: lista de emails con Premium regalado en una variable (`PREMIUM_COMP_EMAILS`, igual que `BANKING_ALLOWED_EMAILS`), sin schema.

### LPBETA-03.1 Activar Stripe en modo test en budget.luisvespa.com
- **Luis, en el panel de Stripe (modo test):** producto "LifePlan Premium" con su precio → `STRIPE_PREMIUM_PRICE_ID`; webhook a `https://budget.luisvespa.com/api/stripe/webhook` con los 5 eventos de 2.9 → `STRIPE_WEBHOOK_SECRET`; `STRIPE_SECRET_KEY` de test. Las tres en Vercel y redesplegar.
- **Claude:** revisar los puntos abiertos de 2.9 antes de activar: cuerpo crudo del webhook en la función de Vercel y `current_period_end` según la versión de la API fijada.
- En modo test nadie paga dinero real: los usuarios usan la tarjeta de prueba `4242 4242 4242 4242`.

### LPBETA-03.2 Control de acceso Premium (servidor y frontend, CLAUDE.md)
- `bankingAccess()` devuelve `premium_required` sin Premium.
- Función igual para importar (`importAccess()`): las rutas de importación responden con error claro sin Premium.
- La interfaz muestra "Hazte Premium" en la franja del banco, en Cuentas y en el botón de importar, en lugar de esconderlos sin explicar. Si Stripe está apagado, no se bloquea nada (no se puede pedir algo que no se puede comprar).
- Textos: la pantalla y el email de Premium pasan a listar lo que incluye (banca e importar).
- Tests del control de acceso y de que la app sigue funcionando sin variables de Stripe.

### LPBETA-03.3 Verificación (en budget.luisvespa.com, modo test)
Usuario sin Premium ve "Hazte Premium" en banca e importar, y las rutas responden error → se hace Premium con `4242…` → vuelve con Premium activo → webhook 200 en el panel de Stripe → email "suscripción activada" → banca e importar funcionan → cancelar → queda "cancela al final del periodo" → reactivar. Con `4000 0000 0000 0341`, email de pago fallido.

### Antes de cobrar dinero real (fuera de este ticket)
- **Vercel Hobby es solo para uso no comercial.** Cobrar exige el plan **Pro** (20 $/mes).
- Claves live de Stripe y webhook live (sin tocar código), cuenta de Stripe como autónomo, IVA (Stripe Tax) y textos legales mínimos (términos, privacidad, cancelación; decisión I).

### Preguntas abiertas para Luis
1. ~~Hogar~~ → plan propio, más caro; compartir hogar sigue gratis (3 nov).
2. ~~Forma de pago~~ → solo anual y barato (3 nov).
3. ~~Precios~~ → aprobados 3 nov: **24 €/año Premium y 36 €/año Hogar**, con precio de fundador. Revisar solo si el coste de Enable Banking por conexión no cabe.
4. ~~Usuarios actuales~~ → gratis para siempre en este entorno (3 nov).

---

## LPBETA-04 · Pequeños pendientes

- Reescribir el comando `/deploy` (`.claude/skills/deploy/`): el paso del `db push` de producción no funciona como está escrito (las variables de Neon son Sensitive); debe dar la receta de "pega la URL entre comillas" en tu terminal.
- Restos de i18n: algunos `€` escritos a mano en otras claves de traducción.
- Movimientos antiguos sin atribuir a una persona del hogar.
- Conectar el banco desde Actividad vuelve a Cuentas tras el consentimiento, en vez de a Actividad.

---

> Los tickets LPBETA-05 a LPBETA-08 salen de [`vision-y-plan-beta.md`](vision-y-plan-beta.md) (4 nov).

## LPBETA-05 · Medir usuarios activos — HECHO (rama `feature/lpbeta-05-medir`, 4 nov)

**Implementado:** `npm run stats:active` (`server/scripts/activeStats.ts`, lógica en `server/lib/activeStats.ts`). Solo lectura; imprime números y fechas, nunca nombres, emails, ids ni importes.
- **Cambio respecto a lo refinado:** la sincronización diaria con el banco escribe movimientos (`source: "bank_sync"`) y adelanta `Account.bankReviewedAt` ella sola, así que ninguna de las dos cosas dice si la persona usó la app. Se añade **`User.lastBankReviewAt`** (schema aditivo), que solo se marca cuando el usuario confirma una revisión de movimientos del banco (`POST /api/banking/connections/:id/confirm`). Las filas `bank_sync` no cuentan como actividad.
- **Aportaciones:** en un hogar cualquiera aporta a cualquier plan del pool, así que se añade **`PlanDeposit.byUserId`** (quién la creó o la cambió por última vez; schema aditivo). Cambiar la aportación del mes también cuenta (`updatedAt`).
- **Limitaciones conocidas:**
  - las filas antiguas sin `createdByUserId` / `byUserId` / `ownerUserId` cuentan para el titular del pool o del plan;
  - un ingreso cuenta para quien lo gana (`Income.ownerUserId`), que es quien lo apunta;
  - **editar** un gasto o un ingreso (p. ej. cambiar la categoría de un movimiento del banco) no cuenta: nada guarda quién lo editó. Quien solo usa la banca cuenta como activo cuando revisa movimientos retenidos, apunta algo o aporta a un plan; si la sincronización no retiene nada y solo mira la app, sale como inactivo;
  - las revisiones de banco y las aportaciones anteriores a este cambio no tienen autor.
- **Uso en producción:** `DATABASE_URL='' npm run stats:active`, con la URL de Neon entre las comillas, en tu terminal.
- Tests: 7 unitarios y uno de integración contra Postgres (qué cuenta y qué no, y que el informe no filtra datos).

### Refinamiento original

**Por qué:** la meta del plan es 1.000 usuarios **activos** y hoy la app no los mide.

**Definición** (`vision-y-plan-beta.md` §3): usuario activo = ha registrado o revisado movimientos en los últimos 30 días.

**Lo que ya existe (verificado, 4 nov):** `User.createdAt`; `Expense.createdAt` y `Expense.createdByUserId` (quién lo apuntó, también en hogares); `Income`, `PlanDeposit` con su fecha de creación; `Account.bankReviewedAt` (revisión de la banca). No hay "último acceso" ni herramientas de analítica, y no se quieren: nada de terceros que vea datos financieros.

**Propuesta:**
- Un **script** `npm run stats:active` (como `repair:partner-data`) que imprime **solo números**, nunca nombres, emails ni importes:
  - registrados en total y en los últimos 7/30 días;
  - activos en 7 y 30 días (alguna fila creada por ellos en `Expense`, `Income`, `PlanDeposit`, o una revisión de banca);
  - hogares con 2 miembros;
  - cuántos tienen al menos un plan de ahorro y cuántos han hecho una aportación en 30 días (medidas de la BETA, §5);
  - retención por semana de alta (de los que se registraron la semana X, cuántos siguen activos).
- Lo ejecuta **Luis en su terminal** contra producción, con la URL de Neon entre comillas, igual que el `db push`. Los datos de producción no pasan por Claude.
- Solo lectura; tests con la base de datos de prueba.

**Más adelante (no ahora):** una pantalla de administración. Exige definir quién es administrador, y eso toca la autenticación (lista de "no modificar sin preguntar").

---

## LPBETA-06 · LifePlan no asesora sobre inversiones (simulador con aviso) — REFINADO

**Por qué:** decisión del 4 nov: LifePlan da el método para ahorrar; cada uno invierte donde quiera. En España el asesoramiento financiero está regulado: la app no debe parecer que recomienda.

**Lo que ya existe (verificado, 4 nov) — importante:**
- Los planes tienen `goalClass` `savings` | `investment`, y los de inversión muestran **"Proyección de Inversión — 3 Escenarios"** (`PlanDetail.tsx:278`):
  - plan de inversión: **1 % / 5 % / 15 %** anual;
  - plan de "riqueza": **5 % / 12 % / 25 %** anual, con etiquetas "Conservador (5%)" y "Agresivo (25%)".
- Un 25 % anual sostenido no es realista, y llamar "conservador" a un 5 % puede leerse como promesa. Para el nuevo cliente esto es lo contrario del mensaje "te damos el método, tú decides".

**Propuesta:**
- **Aviso claro y corto** donde se habla de invertir (crear plan de inversión, detalle del plan, taller): "LifePlan te ayuda a ahorrar. No recomienda productos ni gestiona tu dinero. Las proyecciones son ejemplos, no promesas."
- Lo mismo en la página legal (`LegalPage.tsx`).
- **Proyecciones prudentes**, a decidir por Luis:
  - **(a, recomendada)** un solo escenario que el usuario elige (por defecto un % moderado, p. ej. 4 %) y sin etiquetas de riesgo;
  - (b) mantener 3 escenarios con tasas más bajas (p. ej. 2 % / 4 % / 7 %) y nombres neutros ("bajo / medio / alto");
  - (c) quitar las proyecciones y mostrar solo lo ahorrado y la meta.
- Textos en es y en; sin cambios de schema.

**Decidido 4 nov:** las proyecciones **se mantienen**. No enseñan a invertir: son un **simulador para motivar**, para que el usuario vea cuánto podría crecer su dinero con el tiempo. Se añade el aviso de "simulación, no promesa" junto a la gráfica.
**Tasas, decidido 4 nov: se bajan.** Luis: el escenario más bajo **nunca por debajo del 3,5 %**, porque las cuentas remuneradas ya dan eso y los bonos están en el 4–5 %.
- Nuevas tasas, iguales para los planes de inversión y de "riqueza": **bajo 3,5 % · medio 5 % · alto 7 %** anual (el medio y el alto los propuso Claude: 7 % es una referencia habitual a largo plazo de la bolsa global).
- Nombres neutros: "bajo / medio / alto", sin "conservador" ni "agresivo".
- Las tasas viven en un solo sitio en el código (hoy `projRates` en `PlanDetail.tsx:278`) para poder ajustarlas sin buscar.
- Cambian los textos con porcentajes escritos (`planDetail.conservative`, `aggressive`, `wealthProjectionNote` "5–25%"), en es y en.

---

## LPBETA-07 · Inicio y onboarding para el nuevo cliente — REFINADO (antes de la BETA)

**Por qué:** el cliente objetivo cambió el 4 nov (gana bien, llega justo, sin sistema de ahorro). Hoy la app habla sobre todo de deuda.

**Lo que ya existe (verificado, 4 nov):**
- Onboarding en `src/app/onboarding/`: bienvenida, ingresos, ahorro, tarjetas, préstamos, banco, partidas del presupuesto y resultado. El resultado gira en torno a "X de tus Y ya van a deudas este mes".
- En Inicio, la tarjeta del futuro comprometido ("El N % de tu próximo cobro ya está destinado a deudas").
- Planes de ahorro con meta y aportaciones (Planes).

**Propuesta (a refinar con Luis):**
- **Onboarding:** mismo flujo, otro mensaje. Pregunta inicial sobre el objetivo ("ahorrar de forma constante", "fondo de emergencia", "salir de deudas", "ahorrar para invertir"); las preguntas de tarjetas y préstamos siguen, pero sin protagonismo si el usuario no tiene deudas.
- **Resultado del onboarding:** "Ganas X. Cada mes podrías ahorrar Y si…", con el futuro comprometido como un dato más, no el titular.
- **Inicio orientado a la paz** (lista del 4 nov): arriba, **"Te has pagado X de Y este mes"** (lo apartado para ti frente a tu % de "Págate a ti primero") y un **semáforo con una frase** que resume cómo va el mes. La deuda va debajo.
  - Por definir al diseñar: qué mide el semáforo (¿ahorro, presupuesto o los dos?) y las frases de cada color.
- **Primeras metas al terminar el onboarding** (decisión del 4 nov; sustituye a la del umbral de ahorro, porque el sistema no puede saber si el dinero ahorrado es de verdad un fondo de emergencia):
  1. **Siempre se ofrece crear el plan "Fondo de emergencia"**, también a quien ya tiene ahorros.
     - Meta sugerida: 3 meses de gastos del presupuesto, **editable** (cada usuario decide).
     - Si ya tiene ahorros (el onboarding los pregunta en `SavingsStep.tsx`): la app propone empezar el plan con ese dinero y le dice que lo tenga **separado, en un lugar seguro, por ejemplo una cuenta remunerada**. Es una pauta general, sin recomendar ningún banco ni producto (LPBETA-06).
  2. **Siempre se anima a "Págate a ti primero"**: apartar un **% fijo del sueldo** al cobrar.
     - **El % lo elige cada usuario.** Ejemplos (10 %, 15 %, 20 %) sin marcar ninguno como "el correcto".
     - La app no se ata al método del taller: sirve para el método que cada uno quiera seguir (decisión del 4 nov).
- Revisar los textos que hablen de sobreendeudamiento (web de bienvenida, emails, CLAUDE.md "What this is").

**Preguntas abiertas para Luis:**
1. ~~¿Primera meta?~~ → decidido 4 nov: **siempre** fondo de emergencia (con lo ya ahorrado como punto de partida) **y** "Págate a ti primero" con el % que elija el usuario. Sin umbral.
2. ~~¿Método con nombre propio?~~ → decidido 4 nov: **no**; la app es moldeable al método de cada usuario y cada uno elige su %.
3. ~~¿Antes de la BETA?~~ → decidido 4 nov: **sí, antes de la BETA.**

---

## LPBETA-08 · Enlace de invitación para amigos — APLAZADO (después de la BETA, decisión del 4 nov)

**Por qué:** etapa 3 del plan (crecer por recomendación, sin anuncios).

**Lo que ya existe (verificado, 4 nov):** la invitación a la **pareja** (`PartnerInvite`, une el hogar). El registro es abierto (`POST /api/auth/register` y Google). No hay invitación a amigos ni se sabe quién trajo a quién.

**Propuesta:**
- Cada usuario tiene un **enlace personal** (`budget.luisvespa.com/?ref=CÓDIGO`) para compartir por WhatsApp, con un texto ya escrito.
- Al registrarse con ese enlace se guarda quién le invitó. **Schema aditivo:** `User.referralCode` (único) y `User.referredByUserId` (opcional). Se propone antes de aplicarlo.
- El amigo invitado **no** entra en el hogar ni ve nada del que invita: es solo atribución.
- `stats:active` (LPBETA-05) cuenta registros y activos que llegan por invitación.
- **Recompensa** (idea de Luis, 4 nov): quien invita a **5 personas que se vuelven activas** (definición de LPBETA-05) obtiene un **descuento para comprar Premium**. Requiere LPBETA-03 y LPBETA-05. En Stripe se hace con un cupón de un solo uso. Durante la BETA, sin recompensa.

**Preguntas abiertas para Luis:**
1. ~~¿Ya para la BETA?~~ → decidido 4 nov: **puede esperar**, después de la BETA.
2. ~~¿Recompensa?~~ → decidido 4 nov: **sí**, descuento en Premium al invitar a 5 usuarios que se vuelven activos. Activos durante **30 días** (decidido 4 nov). Falta el % del descuento.

---

> LPBETA-09 a LPBETA-11 salen de la lista para la BETA del 4 nov.

## LPBETA-09 · Borrar la cuenta, exportar los datos y promesa de privacidad — REFINADO (bloquea la BETA)

**Por qué:** confianza y RGPD (derecho de supresión y de portabilidad). En una iglesia donde todos se conocen, "¿quién ve mis números?" es la primera pregunta.

**Lo que ya existe (verificado, 4 nov):**
- Páginas públicas `/privacy` y `/terms` (`LegalPage.tsx`, textos en `legal.*`, actualizados el 29 oct).
- **No hay forma de borrar la cuenta ni de exportar los datos.**
- Casi todas las relaciones de `User` borran en cascada. Pero en un hogar los datos viven en el pool del miembro principal (`userId` = pool): borrar a ese usuario borraría también lo de su pareja.
- Ya existe la separación de una pareja (`server/lib/partnerUnlink.ts`), que reparte los datos de cada uno.

**Propuesta:**
- **Exportar mis datos** (Ajustes): un fichero (JSON, y CSV de movimientos) con **solo lo que es mío** (`ownerUserId` / `createdByUserId`), no lo de la pareja.
- **Borrar mi cuenta** (Ajustes), con confirmación por código al email:
  1. si está en un hogar, primero se separa (`partnerUnlink`): la pareja conserva lo suyo;
  2. se revocan las conexiones con bancos en Enable Banking;
  3. si hay suscripción en Stripe (LPBETA-03), se cancela;
  4. se borra el usuario y todo lo suyo, y se cierra la sesión.
  - **24 horas para arrepentirse** (decisión del 4 nov): al pedirlo se marca la cuenta (`User.deletionRequestedAt`, **schema aditivo**) y se envía un email con "cancelar el borrado". Si entra en la app durante ese plazo, ve "tu cuenta se borrará el …" con el botón de cancelar.
  - El borrado real lo hace la tarea diaria (Vercel Cron, como `/api/banking/cron`, con `CRON_SECRET`): borra las cuentas con más de 24 h de aviso. Con una pasada al día, se borra entre 24 y 48 h después de pedirlo; la promesa lo dice así.
  - Email de confirmación de que se ha borrado.
- **Promesa de privacidad en una página**, en lenguaje sencillo, enlazada desde el onboarding y Ajustes: quién ve tus datos (nadie de la iglesia; en un hogar, solo tu pareja lo que compartes), qué no hacemos (no vendemos ni compartimos datos, no hay anuncios), qué terceros intervienen (Neon, Vercel, Resend, Enable Banking, Anthropic para clasificar sin nombres de comercios a modelos gratis…) y cómo borrar o exportar.
- Tests de integración: borrar al miembro principal de un hogar no toca los datos de la pareja.

**Cuidado:** borrar la cuenta toca la sesión (lista de "no modificar sin preguntar": auth). Este ticket es esa pregunta.

**Preguntas abiertas para Luis:**
1. ~~¿Plazo para arrepentirse?~~ → decidido 4 nov: **24 horas**.
2. ~~¿Quién redacta la promesa?~~ → decidido 4 nov: **la redacta Claude** y Luis la revisa.

---

## LPBETA-10 · Línea de generosidad en el onboarding — REFINADO

**Por qué:** es lo que diferencia LifePlan de YNAB o Ramsey y lo que da sentido a la misión.

**Regla (Método Ruta R1, ya en el código):** la generosidad es la **primera línea del presupuesto** y nunca desaparece; el usuario puede ponerla a 0, pero no borrarla (`server/routes/allocations.ts:260`).
- **Porcentaje libre y opcional.**
- **Sin la palabra "diezmo"**: "generosidad" o "dar", para que sirva dentro y fuera de la iglesia.

**Lo que ya existe (verificado, 4 nov):** el tipo de partida `generosity` en el servidor (no se puede borrar; se copia al separar una pareja). **El onboarding no la crea** y no hay textos para ella en `es.json`/`en.json`.

**Propuesta:**
- Un paso corto en el onboarding, antes de las partidas del presupuesto: "¿Quieres reservar una parte para dar?" con un % libre (ejemplos sin marcar ninguno, y "ahora no" = 0 %).
- Crea la línea de generosidad como primera del presupuesto, con el importe = % de los **ingresos del hogar** (`householdMonthIncome`, el mismo ingreso que usa Inicio). Si cambian los ingresos, se recalcula con el mismo %.
- A quien ya está registrado, crearle la línea a 0 si no la tiene (para que la regla R1 se cumpla para todos).
- En el resultado del onboarding y en Inicio, aparece como "Das X al mes" (sin juicio si es 0).

**Preguntas abiertas para Luis:**
1. ~~¿Sobre qué ingresos?~~ → decidido 4 nov: **los del hogar**.
2. ~~¿Nombre?~~ → decidido 4 nov: **"Generosidad"**.

---

## LPBETA-11 · Instalable en el móvil (PWA) y página de bienvenida — EN REFINAMIENTO

**Por qué:** que todos la instalen en el móvil durante el taller, como una app, sin tiendas.

**Lo que ya existe (verificado, 4 nov):** no hay manifiesto (`public/` solo tiene `robots.txt`; `index.html` sin `manifest` ni `apple-touch-icon`). La pantalla de bienvenida actual es la de después de registrarse ("¡Bienvenido a LifePlan!") y habla de "Planes de Vida" e inversiones.

**Propuesta:**
- **Manifiesto PWA** (`manifest.webmanifest`): nombre, iconos (192 y 512 px, y el de Apple), color de tema, `display: standalone`. Sin modo sin conexión (no hace falta para la BETA y evita servir datos viejos).
- **Instrucciones de instalación** dentro de la app (iPhone: Compartir → Añadir a pantalla de inicio; Android: el aviso de instalar).
- **Página de bienvenida sencilla** para quien llega sin sesión: qué es LifePlan en una frase, el sistema en pasos, la promesa de privacidad (LPBETA-09) y "Crear cuenta". Con el mensaje del nuevo cliente (`vision-y-plan-beta.md`).

**Preguntas abiertas para Luis:**
1. ¿Tienes logo o icono en buena resolución? Si no, preparo uno sencillo provisional.
2. ~~¿Pública o solo con enlace?~~ → decidido 4 nov: **pública**, igual que todo el sistema (registro abierto). Consecuencias:
   - ~~`public/robots.txt` desfasado~~ → **hecho (4 nov, rama `feature/seguridad-acceso`):** permite todo menos `/api/`; ya no menciona la Radiografía.
   - Cualquiera puede registrarse: LPBETA-05 mostrará también los registros que no vienen de invitaciones, y la seguridad del acceso va antes (LPBETA-14).

---

## LPBETA-12 · Detección de suscripciones y gastos hormiga — REFINADO (para la BETA)

**Por qué:** responde a la frase del cliente objetivo: "cada mes desaparece el dinero y no sé en qué". Las suscripciones olvidadas y los pequeños gastos repetidos (café, snacks, envíos, apps) son el dinero que "desaparece" sin que se note.

**Lo que ya existe (verificado, 4 nov):**
- **Detección de cargos recurrentes** (`server/lib/recurring.ts`, `GET /api/recurring`, `RecurringCommitment`): un comercio es recurrente si aparece en **3 meses distintos** con un importe estable (±20 % o ±3 €). Solo cadencia **mensual**. Estados: detectado / confirmado / ignorado, y puede enlazarse a una partida fija.
- Se muestra dentro de las partidas del presupuesto (`RecurringManager` en `AllocationFlow.tsx`), no en Inicio ni en Actividad: es fácil no verlo.
- Cada movimiento tiene `merchant` normalizado (`normalizeMerchant.ts`).
- **No existe nada para gastos hormiga.**

**Propuesta:**
- **Suscripciones** (sobre lo que ya hay):
  - detectar también cadencia **anual** y **semanal** (hoy solo mensual), y cargos nuevos que aparecen por primera vez y se repiten al mes siguiente (pruebas gratis que pasan a cobrarse);
  - aviso de **subida de precio** ("Netflix ha pasado de 12,99 a 15,99");
  - una vista **"Tus suscripciones"**: lista, total al mes y **total al año** ("pagas 540 € al año en suscripciones"), con "la quiero" / "voy a cancelarla" (recordatorio, la app no cancela nada).
- **Gastos hormiga:**
  - gastos **pequeños y frecuentes** en el mismo comercio o la misma categoría: **menos de 10 € y 4 o más veces al mes** (decisión del 4 nov);
  - mostrarlos **sumados y llevados al año**: "Café: 3,20 € × 18 veces = 58 € este mes → ~690 € al año";
  - y unirlo al ahorro (LPBETA-07): "si lo reduces a la mitad, son 345 € al año más para tu plan".
- **Dónde se ve** (decisión del 4 nov): **en Inicio y en un email mensual**; la vista completa en Actividad.
  - **Email mensual** "Tu mes en LifePlan": suscripciones, gastos hormiga y lo que te has pagado (LPBETA-07). Plantilla nueva en `server/lib/email/` (es y en, muestra en `samples.ts`), enviada por una tarea mensual de Vercel Cron.
  - **Darse de baja** del email desde el propio email y en Ajustes (`UserSettings`, columna aditiva). Por RGPD y por respeto.
  - **Límite de Resend:** 100 emails al día en el plan gratis. Con la BETA sobra; al acercarse a los 100 usuarios hay que repartir el envío en varios días o pasar a Cloudflare (decisión K).
- **Sin IA y sin enviar nombres de comercios fuera:** heurística en el servidor sobre los movimientos que ya hay, en céntimos, con tests.
- Respeta la visibilidad del hogar (`expenseListingFilter`).

**Schema (aditivo, pequeño):** `RecurringCommitment.cadence` ya es texto (admite `yearly`/`weekly`). Nuevas: la preferencia del email mensual en `UserSettings`, y quizá el precio anterior en `RecurringCommitment` para avisar de subidas. Se proponen antes.

**Preguntas abiertas para Luis:**
1. ~~¿Umbral?~~ → decidido 4 nov: **menos de 10 € y 4 veces al mes**.
2. ~~¿Dónde?~~ → decidido 4 nov: **Inicio y email mensual**.
3. ~~¿Antes o después de la BETA?~~ → decidido 4 nov: **para la BETA**.

---

## LPBETA-14 · Seguridad del acceso (códigos y contraseñas) — HECHO (rama `feature/seguridad-acceso`, 4 nov)

**Implementado:** código de 6 dígitos con `crypto.randomInt` y comparado en tiempo constante; 5 intentos por código, reservados de forma atómica antes de comparar (`server/lib/otp.ts`, `consumeOtp`); 10 intentos de inicio de sesión y después 15 min de bloqueo, contados en la base de datos (`server/lib/loginThrottle.ts`); `resetToken` de un solo uso, atado a la contraseña que sustituye; restablecer la contraseña quita el bloqueo; email "tu contraseña ha cambiado" (`templates/passwordChanged.ts`); la UI con 6 casillas que caben en el móvil y mensajes traducidos (`auth.otp.*`, `auth.login.tooManyAttempts`). Tests: `otp.test.ts`, `loginThrottle.test.ts`.
**Schema aplicado (aditivo):** `OtpToken.attempts Int @default(0)`, `User.failedLogins Int @default(0)`, `User.loginLockedUntil DateTime?`.
**Al desplegar:** el `db push` de producción va **antes** de subir el código; si no, el login falla por las columnas que faltan.
**Pendiente fuera de este ticket:** `register` sobrescribe la contraseña de una cuenta sin verificar con el mismo email (bajo impacto: la cuenta no tiene datos hasta verificarse; con el límite de 5 intentos ya no se puede forzar el código). Cualquiera puede bloquear 15 min el login por contraseña de otra persona fallando 10 veces; se sale restableciendo la contraseña o con Google.


**Por qué:** el sistema es público (decisión del 4 nov) y guarda datos financieros. Encontrado al revisar qué implica abrirlo. Afecta ya a la alfa desplegada.

**Lo que hay hoy (verificado en el código, 4 nov):**
- **Código de 5 dígitos** (90.000 combinaciones) generado con `Math.random()` (`server/lib/otp.ts:4`), que no es un generador seguro.
- **Sin límite de intentos** en `POST /api/auth/verify-reset-otp`, `POST /api/auth/verify-email` ni `POST /api/auth/login`. Solo `resend-otp` tiene una espera (`auth.ts:389`). El código vale 15 minutos (`OTP_TTL_MS`).
- **Consecuencia:** quien sepa el email de otra persona puede pedir un código de recuperación y probar combinaciones hasta acertar dentro de esos 15 minutos. Después cambia la contraseña y entra en su cuenta. Con `login` sin límite, también se pueden probar contraseñas sin freno.
- El limitador que existe (`server/lib/rateLimit.ts`) vive en memoria, y su propio comentario dice que en Vercel no es una barrera de seguridad (cada instancia cuenta por separado).
- Menores: el código se compara con `===` en vez de en tiempo constante, y el `resetToken` (15 min) se puede usar más de una vez.

**Propuesta:**
- Código de **6 dígitos** con `crypto.randomInt`.
- **Máximo 5 intentos por código**: al quinto fallo se invalida y hay que pedir otro. Necesita un contador en la base de datos. **Schema aditivo:** `OtpToken.attempts Int @default(0)`. Se propone antes de aplicarlo.
- **Límite en `login`** por email (p. ej. 10 fallos en 15 min → esperar), contado en la base de datos, no en memoria. Puede reutilizar la misma tabla o una pequeña nueva (se propone antes).
- Comparación en tiempo constante (`crypto.timingSafeEqual`) y `resetToken` de un solo uso.
- Respuestas que no revelen si un email existe (`send-reset` ya lo hace en parte; revisar `register` y `login`).
- Email de aviso "tu contraseña ha cambiado" con `replyTo` de soporte.
- Tests: el quinto intento fallido invalida el código, el código correcto después ya no sirve, y el bloqueo de login expira.

**Cuidado:** toca la autenticación (lista de "no modificar sin preguntar"). Este ticket es esa pregunta.


---

## LPBETA-15 · Robo de cuenta preparado de antemano (registro + Google) — REFINADO · Prioridad ALTA

**Por qué:** permite entrar en la cuenta de otra persona con todos sus datos financieros, sin saber su contraseña. En una comunidad donde todos se conocen, basta con saber el email del amigo.

**Lo que hay hoy (verificado en el código, 4 nov):**
- `POST /api/auth/register` (`server/routes/auth.ts:300-309`): si el email existe y no está verificado, sobrescribe `passwordHash` con la contraseña nueva.
- `GET /api/auth/google/callback` (`auth.ts:178-190`): hace `upsert` por email y pone `emailVerified`, pero **conserva el `passwordHash`** que hubiera.
- **Ataque:** el atacante se registra con `amigo@gmail.com` y su propia contraseña (la cuenta queda sin verificar). Días después el amigo entra con Google: la cuenta se marca verificada y el atacante entra con su contraseña en la cuenta del amigo.
- Además, el callback acepta el login aunque Google diga `verified_email: false`: una cuenta de Google con un email sin verificar entra en la cuenta existente con ese email.

**Propuesta:**
- Cuando Google verifica una cuenta que **no** estaba verificada, borrar su `passwordHash` (la contraseña la puso alguien que nunca demostró ser el dueño del email). Quien la quiera, la crea con "He olvidado mi contraseña".
- Rechazar el login de Google si `verified_email` no es `true` (`?error=google_failed`).
- Tests: cuenta sin verificar + Google → la contraseña antigua ya no sirve; `verified_email: false` → no hay sesión.

**Cuidado:** toca la autenticación (lista de "no modificar sin preguntar"). Este ticket es esa pregunta.

---

## LPBETA-16 · Límite al envío de códigos por email — REFINADO · Prioridad ALTA

**Por qué:** LPBETA-14 limitó a 5 los intentos **por código**, pero se pueden pedir códigos nuevos sin límite, así que el código de recuperación se puede seguir forzando. Y cada envío gasta la cuota de Resend (100 al día en el plan gratuito).

**Lo que hay hoy (verificado en el código, 4 nov):**
- `POST /api/auth/send-reset` (`auth.ts:420`) no tiene ningún límite: cada llamada borra el código anterior y crea uno nuevo.
- El código se guarda **antes** de enviar el email (`createOtp`), así que es válido aunque el envío falle por cuota.
- **Ataque:** ~200.000 códigos × 5 intentos (≈1,2 millones de peticiones) dan de media un acierto → cambia la contraseña de la víctima. Lento, pero automatizable y sin freno.
- **Efecto secundario:** unas 100 peticiones agotan la cuota diaria de Resend y nadie más puede registrarse ni recuperar su contraseña ese día. También sirve para llenar de emails el buzón de alguien.
- `resend-otp` tiene una espera de 60 s por email, pero ninguna por IP ni un tope diario.
- El limitador en memoria (`server/lib/rateLimit.ts`) no vale en Vercel (lo dice su propio comentario).

**Propuesta:**
- Un **contador en la base de datos** por clave y ventana, reutilizable (lo usa también LPBETA-17). **Schema aditivo**, p. ej. `RateLimitHit { key String, windowStart DateTime, count Int, @@id([key, windowStart]) }`; se propone antes de aplicarlo.
- Límites para `send-reset`, `resend-otp` y `register`: por email (p. ej. 3 cada hora, 10 al día) y por IP (`req.ip`, ya fiable con `trust proxy`).
- **Tope de códigos por cuenta y día** (p. ej. 10): con eso el ataque necesita años.
- Respuesta igual cuando se supera el límite y cuando el email no existe, para no revelar qué emails tienen cuenta.
- Tests: el cuarto envío en una hora se rechaza; un email inexistente responde igual.

**Cuidado:** toca la autenticación.

---

## LPBETA-17 · Límite de uso de la IA (coste) — REFINADO · Prioridad ALTA

**Por qué:** cualquiera puede crear una cuenta gratuita y gastar sin límite en la API de Anthropic, que paga LifePlan (CLAUDE.md: "never expose a route that spends money per request" sin control).

**Lo que hay hoy (verificado en el código, 4 nov):**
- `POST /api/expenses/import/classify` (`server/routes/expenses.ts:392`) y `POST /api/expenses/import/suggest-categories` (`expenses.ts:421`) llaman a la IA **sin límite de peticiones**.
- Recortan a 40 comercios, pero **no la longitud de cada uno**: el cuerpo admite 12 MB, que se convierten en tokens.
- Solo `suggest-mapping` tiene límite (10/hora, `expenses.ts:445`), y es en memoria.

**Propuesta:**
- Pasar los tres endpoints al contador en base de datos de LPBETA-16 (p. ej. 30 llamadas/hora y 100/día por usuario, a confirmar con el uso real de un import).
- Truncar cada comercio a ~100 caracteres antes de mandarlo a la IA.
- Un tope de gasto en la consola de Anthropic como red de seguridad (lo hace Luis, fuera del código).
- Tests: la llamada 31 de la hora devuelve 429 con `code: "rate_limited"`; un comercio largo llega truncado.

---

## LPBETA-18 · Salir del hogar no quita el acceso a los datos de la pareja — REFINADO · Prioridad MEDIA (antes de invitar a nadie)

**Por qué:** los primeros amigos llegan en pareja. Hoy la visibilidad "solo estadísticas" se salta en un clic, y expulsar a alguien del hogar no le quita el acceso.

**Lo que hay hoy (verificado en el código, 4 nov):**
- `DELETE /api/households/members/:userId` (`server/routes/households.ts:210`) solo borra el `HouseholdMember`. **No toca `UserSettings.linkedUserId`**, que es lo que da acceso a los datos (`requireAuth` → `req.userId`).
- Sin hogar, `tier()` (`server/lib/visibility.ts`) devuelve `"transparent"`.
- **Ataque:** en un hogar `shared_stats`, el miembro se "sale" a sí mismo y a partir de ahí lista **todos los movimientos e ingresos** de su pareja.
- Si es el propietario quien expulsa al otro, el expulsado sigue viendo y cambiando todo.
- `/api/partner/unlink` sí lo hace bien (`unlinkMemberFromPool`, en una transacción).

**Propuesta:**
- Que este endpoint haga lo mismo que `/partner/unlink`: `unlinkMemberFromPool` con los bloqueos de `lockSettings`. O quitarlo y que la UI use solo `/partner/unlink`.
- Por defensa en profundidad: si `linkedUserId` apunta a un pool pero no hay `HouseholdMember` activo, aplicar la visibilidad más restrictiva, no `transparent`.
- Tests: tras salir del hogar, `GET /api/expenses` ya no devuelve movimientos de la pareja; el expulsado recibe sus propios datos y nada más.

---

## LPBETA-19 · Las deudas y cuentas privadas se ven y se modifican desde la pareja — REFINADO · Prioridad MEDIA

**Por qué:** una deuda o cuenta marcada "privada" debe ser invisible para la pareja. Es parte de la promesa de privacidad (LPBETA-09) y justo lo que el nuevo cliente no quiere enseñar.

**Lo que hay hoy (verificado en el código, 4 nov):**
- `ensureDebtLine` (`server/lib/debtBalance.ts:342`) crea una línea de presupuesto (`Allocation` tipo `debt`) para **todas** las deudas activas, también las privadas, con el nombre de la deuda.
- `GET /api/allocations`, `GET /api/monthly-budgets` (y `/review`) y `GET /api/analytics` no filtran esas líneas: la pareja ve el **nombre, el id y la cuota mensual** de la deuda privada, aunque `GET /api/debts` la oculta.
- Además se puede **escribir** en ella:
  - `POST /api/expenses` o `PATCH /api/expenses/:id` con esa línea: `debtForAllocation` (`expenses.ts:35`) solo comprueba el pool, así que el gasto se convierte en un pago de la deuda privada y cambia su saldo (puede llegar a marcarla `paid_off`).
  - `POST /api/expenses/import/confirm` con `{ kind: "payment", debtId }` (`server/lib/ingest/confirm.ts:68`) carga todas las deudas del pool, y la respuesta devuelve su nombre.
  - `POST /api/allocations { type: "debt", debtId }` (`allocations.ts:69`) solo comprueba el pool.
- Ingresos: `ownedAccountId` (`server/routes/income.ts:16`) no aplica `visibleToWhere`. Se puede registrar un ingreso en la **cuenta privada** de la pareja, y la respuesta revela su nombre y tipo. Los gastos ya lo hacen bien (`resolveAccountId`).

**Propuesta:**
- Lecturas: ocultar las líneas de deuda cuya deuda es privada de otro miembro (en presupuesto, revisión y analítica). En los totales agregados pueden seguir contando, como ya está documentado para los saldos.
- Escrituras: aplicar `visibleToWhere(req.authUserId)` en `debtForAllocation`, en la lista de deudas de `confirmImport`, en `POST /api/allocations` y en `ownedAccountId` de ingresos.
- Tests con un hogar de dos miembros: la deuda privada de A no aparece en `GET /api/allocations` de B; B no puede pagarla ni por gasto ni por import; B no puede usar la cuenta privada de A en un ingreso.

---

## LPBETA-20 · La invitación de pareja no está ligada al email invitado — REFINADO · Prioridad MEDIA

**Por qué:** aceptar una invitación da acceso total a las finanzas de quien invita. Hoy lo consigue cualquiera que tenga el enlace, no solo la persona invitada.

**Lo que hay hoy (verificado en el código, 4 nov):**
- `POST /api/partner/accept` (`server/routes/partner.ts:189`) comprueba el token, pero **no que el email del que acepta sea `invitedEmail`**.
- El token es un UUID aleatorio (no se puede adivinar), pero el enlace viaja por email y WhatsApp: un reenvío, un pantallazo o un chat de grupo bastan.
- `GET /api/partner/invite/:token` (`partner.ts:163`, público) devuelve el nombre y el email de quien invita.

**Decidido (Luis, 4 nov):** la invitación de pareja es **solo para el email que la recibió**. Con otro email no se puede aceptar: quien invita genera una invitación nueva para el email correcto. Es más molesto, pero más seguro (Luis, 4 nov).

**Propuesta:**
- Aceptar solo si el email (normalizado: minúsculas y sin espacios) de la cuenta que acepta coincide con `invitedEmail`. Si no coincide: 403 con un error claro y traducido que diga qué hacer, sin revelar el email invitado ("Esta invitación es para otro email. Pide a quien te invitó que te envíe una nueva a tu email de LifePlan").
- Que el endpoint público devuelva solo lo necesario (nombre de quien invita), no su email.
- Tests: otra cuenta con el token recibe 403; la cuenta invitada lo acepta; mayúsculas o espacios en el email no impiden aceptar.

---

## LPBETA-21 · Cerrar todas las sesiones (sesiones revocables) — REFINADO · Prioridad MEDIA

**Por qué:** si alguien roba una sesión (un portátil compartido, un móvil perdido), hoy no hay forma de echarle.

**Lo que hay hoy (verificado en el código, 4 nov):**
- La sesión es un JWT de 7 días (`server/lib/jwt.ts`) sin versión ni lista de revocadas.
- Cambiar la contraseña (`/reset-password`) **no cierra** las sesiones abiertas.
- `/logout` solo borra la cookie de ese navegador; el token sigue valiendo si se copió.

**Propuesta:**
- **Schema aditivo:** `User.tokenVersion Int @default(0)`; se propone antes de aplicarlo. El JWT lleva la versión y `requireAuth` (que ya lee el usuario en cada petición) la compara.
- Subir la versión al restablecer la contraseña y con un botón "Cerrar sesión en todos los dispositivos" en Ajustes.
- Tests: tras el reset, la cookie anterior recibe 401; la nueva funciona.

**Cuidado:** toca el middleware de autenticación (lista de "no modificar sin preguntar").

---

## LPBETA-22 · Dependencias con vulnerabilidades conocidas — REFINADO · Prioridad MEDIA

**Por qué:** `npm audit --omit=dev` (4 nov) da 6 vulnerabilidades: 2 críticas, 3 altas y 1 moderada.

**Lo que hay hoy:**
- `proxy-addr` — **crítica**: IP falsificable con direcciones IPv4 mapeadas en IPv6. Afecta a `req.ip`, que usarán los límites de LPBETA-16. Se arregla con `npm audit fix`.
- `body-parser` y `qs` (vía `express`) — DoS. Sin arreglo publicado para Express 4.
- `xlsx@0.18.5` — prototype pollution y ReDoS. Hoy solo se usa en tests y fixtures (`server/lib/ingest/fixtures/makeFixtures.ts`), no con archivos de usuarios.
- `react-router@7.13.0` — los avisos afectan sobre todo al modo SSR/RSC, que esta SPA no usa; mirar los de redirección abierta.

**Propuesta:**
- `npm audit fix` y `npm run verify`.
- Mover `xlsx` a `devDependencies` o cambiarlo por la versión del CDN de SheetJS (la de npm ya no recibe parches). Si algún día se leen Excel de usuarios en el servidor, tiene que ser con la versión parcheada.
- Subir `react-router` cuando haya versión arreglada; valorar Express 5 para `body-parser`/`qs`.
- Añadir `npm audit --omit=dev --audit-level=critical` al CI.

---

## LPBETA-23 · Endurecimiento menor de seguridad — REFINADO · Prioridad BAJA

**Por qué:** ninguno da hoy acceso a datos ajenos, pero cada uno quita una pieza a un ataque futuro. Se pueden hacer por partes.

**Lista (verificado en el código, 4 nov):**
1. **Stripe `/confirm-session`** (`server/routes/stripe.ts:109`): no comprueba que la sesión de pago sea del usuario (`client_reference_id` o `customer`). Un pago puede activar Premium en varias cuentas. Impacto bajo hoy (Stripe apagado, Premium no desbloquea nada). **Hacerlo dentro de LPBETA-03.**
2. **Token de Google en la URL** (`auth.ts:203`, `?token=`): vale 2 minutos y se puede usar más de una vez; queda en el historial y en los logs. Hacerlo de un solo uso o mandarlo en una cookie corta.
3. **Pagador y reparto sin validar** (`expenses.ts:188, 209, 516, 530`): se aceptan ids de usuarios ajenos al hogar. No da acceso a nada, pero corrompe los balances del hogar. Exigir miembros activos (o el propio usuario si no hay hogar).
4. **Dueño de cuenta no activo** (`server/routes/accounts.ts:183`): se puede pasar una cuenta a un miembro invitado o que ya salió (falta `status: "active"`).
5. **Saber si un email tiene cuenta**: `register` responde 409 y el bloqueo de login 429 solo para cuentas que existen. Respuestas iguales en ambos casos.
6. **Emails sin normalizar** en registro, login y recuperación: `Ana@x.com` y `ana@x.com` son cuentas distintas. Pasar a minúsculas y quitar espacios (con un script que compruebe antes que no hay duplicados en producción).
7. **Cabeceras de seguridad**: no hay CSP, HSTS ni `X-Frame-Options` (ni en Express ni en `vercel.json`), así que la app se puede incrustar en otra web (clickjacking). Añadirlas en `vercel.json` (`headers`) para el frontend y con `helmet` en la API.
8. **No es seguridad, regla de negocio:** la línea de generosidad se puede borrar cambiándola antes a `flexible` (`allocations.ts:234, 262`). Impedir cambiar el tipo de `generosity`.

---

## LPBETA-13 · Celebrar los hitos — EN REFINAMIENTO

**Por qué:** la paz y la disciplina se sostienen viendo el progreso. Los momentos "lo hemos conseguido" (primer mes ahorrando, una deuda cerrada) son los que el usuario recuerda y los que luego cuenta como testimonio en los talleres y en las redes (`vision-y-plan-beta.md` §5 y §7). La app **no enseña** (decisión del 4 nov: enseña la empresa, en los talleres y las redes); celebrar no es enseñar, es reconocer lo que el usuario ya hizo.

**Lo que ya existe (verificado, 4 nov):**
- **Hitos de plan:** `LifePlan.milestones` (array JSON de importes, pensado para planes de inversión), editables en `PlanDetail.tsx` (sección "Hitos"). Hoy solo se muestran; no pasa nada al alcanzarlos.
- **Plan completado:** estado `completed` en el detalle del plan.
- **Deuda cerrada:** `Debt.status = "paid_off"` (`server/routes/debts.ts:437`).
- **Aportaciones que faltan:** Inicio ya avisa de los planes sin aportar este mes (`missedPlans`). Existe el aviso negativo, pero no el positivo.
- **Ojo, textos que prometen algo que no existe:** Ajustes muestra los interruptores "Hitos del plan: recibe notificaciones cuando alcances marcadores de progreso", "Recordatorios mensuales", "Alertas de presupuesto" y "Smart insights" (`PlanningSettings.tsx:179`). Son estado local de React: no se guardan y nada envía notificaciones. Va contra la regla de que los textos solo describen lo que el código hace.

**Propuesta:**
- **Qué se celebra** (calculado desde los datos que ya existen, sin guardar el evento: "derivar, no almacenar"):
  1. la primera aportación a un plan;
  2. el primer mes en que se cumple el % de "Págate a ti primero" (depende de LPBETA-07), y las rachas (3, 6, 12 meses seguidos);
  3. un hito de un plan alcanzado y un plan completado;
  4. el fondo de emergencia completo;
  5. una deuda cerrada: "Has cerrado X. Liberas N € al mes" (enlaza con el futuro comprometido);
  6. un mes cerrado dentro del presupuesto.
- **Cómo:** una tarjeta de celebración en Inicio, **una sola vez por evento**, sobria y en el tono de la marca (verde, frase corta y "Seguir"). Sin juicio cuando no se consigue.
- **Hogar:** los dos miembros ven las celebraciones de lo compartido; las de lo privado, solo su dueño (`visibility.ts`).
- **"Ya visto":** para no repetir la celebración en cada visita ni en cada dispositivo, hace falta guardar qué eventos ha visto ya el usuario. **Schema aditivo** (p. ej. `UserSettings.seenCelebrations`, texto JSON, o una tabla pequeña); se propone antes de aplicarlo. `localStorage` no vale: la repetiría en el móvil después de verla en el ordenador.
- **Los interruptores de notificaciones de Ajustes:** quitarlos hasta que haya notificaciones de verdad, o dejar solo los que este ticket haga reales.
- Textos en es y en, y tests de la detección de eventos (en céntimos, con datos de hogar).

**Preguntas abiertas para Luis:**
1. ¿Botón de "compartir" (imagen o texto para WhatsApp)? Si lo hay, por defecto **sin importes** ("¡Hemos cerrado una deuda!"), para que nadie de la comunidad vea las cifras de otro.
2. ¿Tono: sobrio (tarjeta) o festivo (confeti)?
3. ¿Los interruptores de notificaciones: se quitan ya o se dejan para cuando este ticket esté hecho?
4. ¿Antes o después de la BETA?

---

## LPBETA-24 · Medir la paz: una pregunta al mes — EN REFINAMIENTO

**Por qué:** la misión promete que ver y controlar el dinero "genera paz interior". LPBETA-05 mide el **uso**, no la paz. Sin un dato propio, no se puede decir si la misión funciona, y los testimonios ("pasamos de 2 a 4 en tres meses") dependerían de la memoria de cada uno. **No enseña nada** (decisión del 4 nov: la app no enseña), solo pregunta.

**Lo que ya existe (verificado, 4 nov):** nada parecido. El periodo de presupuesto de cada usuario se calcula desde su `cycleStartDay` (`server/lib/period.ts`, etiqueta `YYYY-MM`). `npm run stats:active` (LPBETA-05) ya imprime recuentos agregados sin nombres ni importes.

**Propuesta:**
- **La pregunta:** *"¿Cómo te sientes hoy con tu dinero?"*, con 5 opciones de 1 (muy intranquilo) a 5 (en paz), cada una con una palabra corta. Sin texto libre: más rápido de responder y nada sensible que guardar.
- **Cuándo:** una vez por periodo de presupuesto (el del día de cobro de cada uno), como una tarjeta pequeña en Inicio. Aparece al empezar el periodo, o en la primera visita de quien acaba de registrarse (**esa es la línea base**). Se puede cerrar ("ahora no") y no vuelve hasta el periodo siguiente. Nunca más de una vez por periodo, sin emails ni notificaciones.
- **Para el usuario:** después de responder, si ya hay 2 o más respuestas, una línea sencilla con su evolución ("hace 3 meses: 2 · hoy: 4"). Sin juicio si baja.
- **Hogar:** cada persona responde por sí misma y **su respuesta es privada**: la pareja no la ve.
- **Para Luis (`stats:active`):** media del último periodo, cuántos respondieron, distribución 1–5 y, de quienes tienen 2 o más respuestas, cuántos suben, igual o bajan. **Solo si hay al menos 5 respuestas en el grupo**: con amigos que se conocen, una media de 2 personas identifica a alguien. Nunca respuestas individuales.
- **Schema (aditivo, se propone antes de aplicarlo):** una tabla `PeaceCheckin` (`id`, `userId`, `period` "YYYY-MM", `score` 1–5, `createdAt`), única por (`userId`, `period`). Se borra en cascada con el usuario (LPBETA-09). El periodo se guarda porque hace falta para la unicidad; si el usuario cambia su día de cobro, las respuestas antiguas quedan en su periodo original.
- **API:** `GET /api/checkins` (las mías y si toca preguntar este periodo) y `POST /api/checkins` (`{ score }`, el servidor pone el periodo), detrás de `requireAuth`. Responder cuenta como actividad para LPBETA-05.
- **Privacidad:** se menciona en la promesa de privacidad (LPBETA-09): "una pregunta al mes sobre cómo te sientes con tu dinero; solo tú ves tu respuesta y Luis solo ve medias de grupos de 5 o más".
- Textos en es y en. Tests: una respuesta por periodo, el umbral de 5 en las estadísticas, y que la pareja no ve la respuesta.

**Preguntas abiertas para Luis:**
1. ¿Te vale la frase *"¿Cómo te sientes hoy con tu dinero?"* y la escala de 1 a 5? (Alternativa: caras o emojis en vez de números.)
2. ¿El usuario ve su propia evolución, o solo la pregunta?
3. ¿Dónde lo colocas en el orden? (Propuesta: después del 09, antes de la primera ola de amigos.)

---

## LPBETA-25 · Dominio de la BETA: `app.luisvespa.com` — REFINADO (decidido el 4 nov)

**Por qué:** "budget" va contra el mensaje (vendemos ahorro y paz, no presupuestos), y `app.` sirve para cualquier nombre que se elija en LPBETA-26. La app sigue colgando de la marca personal (Luis Vespa → Método Ruta → la app).

**Lo que ya existe (verificado, 4 nov):** el dominio llega por variables de entorno (`APP_URL`, `GOOGLE_CALLBACK_URL`, `BANKING_CALLBACK_URL`); el código no lo lleva escrito salvo en textos. `budget.luisvespa.com` aparece escrito a mano en: la introducción de la política de privacidad y de los términos (`legal.*` en `es.json`/`en.json`), `CLAUDE.md` (fila de `BANKING_CALLBACK_URL`), el comando `/deploy` (`.claude/skills/deploy/SKILL.md`), `docs/` y algunos tests (solo como dato de ejemplo).

**Pasos de Luis (paneles; los secretos nunca pasan por Claude):**
1. **Cloudflare:** registro `CNAME app → cname.vercel-dns.com`, con el proxy **desactivado** (nube gris), igual que `budget`.
2. **Vercel → Domains:** añadir `app.luisvespa.com` al proyecto. Cuando funcione, configurar `budget.luisvespa.com` como **redirección 308 a `app.luisvespa.com`**, para que sigan funcionando los enlaces antiguos de los emails ya enviados.
3. **Google Cloud Console:** añadir la URL de retorno `https://app.luisvespa.com/api/auth/google/callback`. La antigua se quita cuando todo funcione.
4. **Enable Banking:** registrar `https://app.luisvespa.com/api/banking/callback`. Comprobar si en modo restringido hace falta que ellos lo aprueben, y si tardan, hacer este paso el primero.
5. **Variables en Vercel (Production):** `APP_URL=https://app.luisvespa.com`, `GOOGLE_CALLBACK_URL=…/api/auth/google/callback`, `BANKING_CALLBACK_URL=…/api/banking/callback`, y redesplegar.
6. Stripe está apagado; cuando se active (LPBETA-03), su webhook ya irá a `app.`.

**Parte de Claude (un PR):** cambiar `budget.` por `app.` en los textos legales (es y en), en `CLAUDE.md`, en `docs/` y en los tests. **El comando `/deploy` vive en `.claude/skills/`, que el sandbox de Claude no deja editar:** o lo cambia Luis, o da permiso para esa edición. Los tests que usan `budget.luisvespa.com` como ejemplo pueden quedarse así.

**Efectos para los usuarios:**
- La sesión es una cookie del dominio antiguo: **los 2 usuarios tendrán que iniciar sesión otra vez**, una sola vez. Avisarles.
- Las conexiones con bancos ya hechas siguen funcionando: la URL de retorno solo se usa al conectar o renovar.
- La app instalada en el móvil (LPBETA-11) todavía no existe, así que no hay nada instalado que migrar. Es otra razón para hacerlo ya.

**Verificación (en producción):** `GET https://app.luisvespa.com/api/health` → 200; login con email y con Google; conectar un banco en el sandbox de Enable Banking (si aplica); el enlace de un email nuevo apunta a `app.`; `https://budget.luisvespa.com/cualquier-ruta` redirige a `app.`.

---

## LPBETA-26 · Nuevo nombre de la app: Remanso — DECIDIDO (4 nov)

**Decisión de Luis (4 nov): Remanso.** Sereno queda como alternativa si la comprobación de marca encuentra un problema. Antes de publicar, siguen haciendo falta los pasos 2 y 3 de abajo (OEPM/EUIPO y dominio `.es`). La encuesta de YouTube ya no es para decidir, pero puede servir como contenido ("así se llama la app").

**Por qué (investigación del 4 nov):** "LifePlan" está muy ocupado en finanzas (la herramienta "Life Plan" de Bank of America, una marca LIFEPLAN de software registrada en EE. UU., el software LIFEPlan de planificación financiera de Maxomsoft y varias apps con ese nombre). Además es genérico, está en inglés para un público español y no transmite la promesa de paz. Cambiarlo ahora cuesta poco: 2 usuarios y casi nada publicado.

**Finalistas (decisión del 4 nov):**
- **Remanso** (recomendación de Claude): agua en calma; para el público de la iglesia recuerda las "aguas de reposo" del Salmo 23. Lema posible: *"Remanso: tu dinero, en calma."* No se encontraron apps de finanzas con ese nombre. `remanso.app` y `remansoapp.com` están ocupados; `usaremanso.com` y `remansofinanzas.com` estaban libres el 4 nov.
- **Sereno:** calma y claridad. No se encontraron choques en finanzas.
- Descartados: Granero (en Lucas 12 los graneros del rico necio son una advertencia contra acumular), Siembra (AFP Siembra, pensiones, República Dominicana), Cuentas Claras (Mis Cuentas Claras, app de finanzas del hogar).

**Pasos de Luis para decidir:**
1. Encuesta en la pestaña Comunidad de YouTube (Luisvespa.oficial) y preguntar a los 2 usuarios actuales.
2. Buscar el elegido en el localizador de la OEPM y en EUIPO eSearch, clases 9 (software), 36 (finanzas) y 42 (servicios de software). Para el registro definitivo, un abogado de marcas.
3. Comprobar en dominios.es si el `.es` está libre (la búsqueda del 4 nov no cubre `.es`).

**Parte de Claude cuando haya nombre (un PR, sin schema):**
- La marca visible: `productName` en `server/lib/email/theme.ts`, unas 22 apariciones en cada `es.json`/`en.json`, el `<title>` de `index.html`, los textos legales, el nombre del remitente en `EMAIL_FROM` (lo cambia Luis en Vercel) y los textos de la página de bienvenida (LPBETA-11).
- **Cuidado: `LifePlan` también es el nombre interno de los planes de ahorro** (`model LifePlan` en el schema, `usePlans.ts`, `planContribution.ts`…). **Eso no se renombra**: es código y base de datos, no marca, y cambiarlo exigiría una migración que este proyecto no usa.
- `CLAUDE.md` y el comando `/deploy` (este último lo cambia Luis o lo autoriza, como en LPBETA-25).

**Preguntas abiertas para Luis:**
1. ¿Remanso o Sereno? (Tras la encuesta.)
2. ¿Lema? Propuesta para Remanso: *"tu dinero, en calma"*.

---

## LPBETA-27 · Rediseño de toda la app para Remanso — EN REFINAMIENTO

**Estado (4 nov):** Luis pidió a Claude el rediseño y el logo. **Propuesta de la fase 1 publicada** como sistema de diseño (https://claude.ai/artifact/WMDkSACG5weNQxzPB6KyB5): logo (marca, versión de una tinta e icono de app), paleta clara y oscura con contraste AA comprobado, Fraunces + Figtree, espacios, radios y 10 componentes base. **Falta la aprobación de Luis** antes de llevarla a `theme.css` y a las pantallas. **Confirmado por Luis (4 nov):** lo diseña Claude, logo provisional de Claude, claro y oscuro desde el principio. **Canal (corregido por Luis, 4 nov):** Luisvespa.oficial sigue siendo su marca personal, con su propia identidad; Remanso es un producto que se promociona desde ahí (y quizá desde otros creadores). El canal no se adapta a Remanso.

**Por qué (decisión del 4 nov):** la app cambia de nombre (Remanso), de cliente (familias que ganan bien y quieren ahorrar) y de promesa (**ver tu dinero da calma**). La interfaz de hoy nació para otra cosa: un presupuesto y un tablero de deudas, con el tema por defecto de shadcn y mucho número a la vista. Remanso tiene que **sentirse** tranquila, no solo decirlo.

**Lo que ya existe (verificado, 4 nov):**
- Tema en `src/styles/theme.css`: azul `#1E3A8A` (primary), verde `#10B981` (secondary), ámbar `#F59E0B` (accent), fondo `#F9FAFB`, radio `0.875rem`, con modo oscuro. Tipografías Outfit (títulos y números) y Manrope (texto), en `fonts.css`.
- 31 pantallas y componentes en `src/app/components/` y 48 componentes de shadcn/ui en `ui/`.
- Las pautas de interfaz de `CLAUDE.md` (FAB, modales, tarjetas con degradado, tipografía, colores de estado) describen el diseño actual. **Cambiarán con el rediseño.**
- **Dependencias que no se usan:** `@mui/material`, `@mui/icons-material`, `@emotion/*`, `react-slick`, `react-responsive-masonry` y `@popperjs/core` están en `package.json`, pero ningún fichero de `src/` los importa. Restos de la plantilla de Figma: se quitan en este ticket.

**Propuesta, en dos fases:**

**Fase 1: sistema de diseño (antes que cualquier pantalla nueva).**
- Principios: calma antes que datos (una respuesta clara por pantalla: "¿vamos bien?"), mucho aire, pocos números a la vez, sin rojo alarmista (el rojo solo para errores reales) y lenguaje amable.
- **Identidad:** logo e icono de app (sirve también para la PWA, LPBETA-11), paleta nueva inspirada en el agua en calma, tipografía, radios, sombras y movimiento (transiciones suaves y cortas).
- **Tokens** en `theme.css` (claro y oscuro), con contraste AA comprobado.
- **Componentes base:** tarjeta, tarjeta principal, semáforo de estado, botones, campos, FAB, hoja o modal, estados vacíos y gráficas (colores de series).
- Un **documento de referencia** visual del sistema y la actualización de las pautas de `CLAUDE.md`.

**Fase 2: pantallas.** Se rediseña cada pantalla cuando se toca su ticket (Inicio y onboarding en el 07, bienvenida en el 11…), y al final las que no tengan ticket propio: Actividad, Deudas, Planes, Cuentas, Hogar y Ajustes. Cada una en su PR, probada en el móvil (375 px) y en el escritorio, en claro y oscuro.

**Fuera de alcance:** cambiar la lógica, las rutas o el schema. El rediseño es visual y de textos.

**Preguntas abiertas para Luis:**
1. ¿Hay diseñador, o lo propone Claude? (Claude puede preparar el sistema de diseño como página de referencia o en Figma, si Luis tiene cuenta.)
2. ¿Logo: lo encargas, o Claude prepara una propuesta provisional?
3. ¿Hay que parecerse al canal de YouTube (colores o miniaturas actuales), o el canal se adaptará a Remanso?
4. ¿Modo oscuro desde el principio, o solo claro en la primera versión?
