# Plan — Onboarding unificado de la Radiografía Financiera

> Diagnóstico y plan. Sin código.
> Fecha: 14 ago 2026. Lanzamiento: 12 sep 2026 (29 días).

---

## 0. Contradicciones con lo ya decidido (leer antes que nada)

El brief contradice tres cosas que están congeladas en `docs/scope-release.md` o que se decidieron el
11 ago. No asumo cuál gana: las señalo y espero decisión (§6, Q9 y Q2).

| # | El brief dice | Lo ya decidido dice | Impacto |
|---|---|---|---|
| C1 | Parciales guardados y radiografías versionadas | `scope-release.md` FUERA DE SCOPE: *"Cuentas de usuario, login, historial de radiografías"* → v2 | **Reducido** al confirmar que no se construye identidad (§0.2): no hay cuentas ni login. Queda en pie el *historial de radiografías* y el guardado de parciales |
| C2 | Perfil canónico persistido con importes por campo | `scope-release.md` FUERA DE SCOPE: *"Guardar importes financieros en bruto"*. El 11 ago se eligió *"tabla nueva solo % + purga real"* | Invierte la decisión de privacidad de hace 3 días. Todo §2 y §4 dependen de cuál gana |
| C3 | El usuario se ubica en 1 de **5 etapas** | `scope-release.md`: el informe contrasta con **10/50/20/20**. El 11 ago se eligió *"10/50/20/20 base + arquetipo encima"* | Hay **tres** modelos diagnósticos (5 etapas, 10/50/20/20, 7 arquetipos). Uno de más. Encaje propuesto en §3.6 |

**Supersesión aceptada, no conflicto:** el brief pide el email en el Bloque 2 y `scope-release.md` decía
*"sin email hasta el resultado"*. El brief gana y el principio del scope se corrige — ver §0.1, donde el
adelanto del email es el mecanismo, no un coste.

El brief **revierte** (explícitamente, no es contradicción) la decisión del 11 ago de que el extracto era
el diferenciador: ahora es *"siempre opcional, nunca puerta de entrada"*. Acatado, y resulta ser lo
correcto — ver el veredicto del parser en §1.5.

**Estado del repo, sin adornos:** el árbol está **igual que el 11 ago**. 33 ficheros modificados sin
commitear, solo rama `main`, sin ramas de épica. `src/radiografia/` no existe. `VITE_ENABLE_BUDGETAPP`
no existe en código (solo en docs; no gatea nada). La Épica 0 —bloqueante, con fecha 11–13 ago— **no ha
empezado**.

### 0.1 El intercambio: qué se ve gratis y qué se gana con el email

Sin contraseñas en ningún punto. La radiografía **se vincula a un email**, y ese email se confirma con un
**código OTP de 6 dígitos**. La confirmación cumple dos funciones a la vez, y por eso va antes del
resultado y no después:

1. **Filtro de calidad del lead.** Un email no confirmado es un email inventado. Confirmar excluye la
   basura de la lista antes de que entre, no después.
2. **Momento de persuasión.** El paso 2 es donde se argumenta que el informe completo tiene valor real.
   El usuario confirma porque quiere el informe, no porque un formulario se lo exija.

**En pantalla (gratis, sin inbox): exactamente tres cosas.**
- La **puntuación**.
- La **categoría asignada** (la etapa del método).
- La **frase descriptiva del tipo de usuario** (el arquetipo).

Nada más. Ni desglose por áreas, ni porcentajes, ni fugas, ni pasos siguientes.

**Por correo: el informe detallado completo**, más el eBook. La versión web permanente del informe
detallado vive en una **URL con token accesible solo desde ese correo** — lo que refuerza el intercambio:
el detalle exige haber demostrado que el email es tuyo.

Esto encaja con `scope-release.md` mejor de lo que parecía: su *"nunca bloquear todo el resultado detrás
del email"* se cumple (puntuación y categoría son gratis), y su enlace permanente al informe sigue
existiendo, solo que como recompensa y no como página pública.

**Ventaja de implementación:** las tres cosas de pantalla ya existen y están probadas — `health.score`,
y `archetypeLabel()` / `archetypeDescription()` de `server/lib/xray/labels.ts` (7 arquetipos con copy
es+en ya escrito, 13 tests). El teaser no hay que inventarlo.

### 0.2 Confirmar el correo NO es construir identidad

Decisión explícita: **se confirma el correo, no se construye identidad.** El OTP prueba que el email
existe y recibe. Nada más. Esto es una restricción de alcance, no un detalle de implementación, y
elimina lo más caro del plan:

| No se construye | Sí se construye |
|---|---|
| Cuentas, login, logout | Un código de 6 dígitos que verifica que el email recibe |
| Sesión, cookie de sesión, JWT para este flujo | Un `emailVerifiedAt` en el perfil |
| Enlace mágico para "entrar" | Un **token de capacidad** por radiografía (ver abajo) |
| Recuperación de cuenta, cambio de email | Nada |

**Cómo se retoma una radiografía a medias, sin sesión.** Tras confirmar el código, el servidor devuelve
un **token de capacidad** opaco, con alcance a *esa* radiografía y nada más. El cliente lo guarda en
`sessionStorage` y con él sigue rellenando pasos. No es una credencial de usuario: no da acceso a ningún
otro perfil, no sobrevive al cierre del navegador, y no autentica a nadie. Es el mismo concepto que la
URL del informe.

**Consecuencia que hay que aceptar:** **no hay reanudación entre dispositivos.** Empezar en el móvil y
seguir en el portátil requeriría identidad. Lo que sí se puede es enviar por correo un enlace con el
token de capacidad al perfil abandonado (el perfil 3 del brief, "recuperable por correo") — eso es un
enlace a *una* radiografía, no un inicio de sesión.

**El email sigue siendo la clave de unión para la fase 2.** Se guarda y se verifica ahora; cuando esa
persona se registre en la app más adelante, se localiza su perfil por email y no vuelve a introducir
nada. Pero **hoy no se crea ninguna fila en `User`** y no existe el concepto de "estar conectado".

**Y no se reutiliza la maquinaria de auth de la BudgetApp.** Mi borrador anterior proponía extender
`OtpToken`; eso estaba mal por dos razones: es un modelo de la auth de la BudgetApp (que `CLAUDE.md`
marca como "no modificar sin preguntar") y acoplarlo violaría la regla de dirección única que persigue
la Épica 0. Va tabla propia y aislada — ver §2.3.

---

## 1. Diagnóstico del estado actual

### 1.1 Los dos formularios

**Manual — `src/app/components/xray/XRayQuickEstimate.tsx`** (170 líneas, una sola pantalla)

- Estado: 4 `useState` — `income: string`, `rows: DebtRow[]`, `sending`, `error`.
  `DebtRow { id, name, kind: DebtKind, monthlyPayment }`, `id` de un contador de módulo `rowSeq`.
- **Captura solo 2 conceptos: ingreso mensual y una lista de deudas.** No hay vivienda, ni gastos
  esenciales, ni disfrute, ni ahorro, ni activos. Es ~15% de los insumos que el brief necesita.
- Validación: `canSubmit = Number.isFinite(incomeNum) && incomeNum > 0 && validRows.length > 0`.
  Las filas incompletas se descartan en silencio, sin marcar el error al usuario.
- Bug latente: `income.replace(',', '.')` no es global (solo la primera coma).
- **Persistencia: ninguna.** Todo en memoria, se pierde al refrescar.
- POST → `/api/xray/quick-estimate`. El servidor **fabrica un `XRayResult` con forma completa pero a
  cero** (`categories: []`, `wealth` vacío, `balances.hasData: false`, `health` con **un solo pilar**
  `debtLoad`) y persiste un `XRaySession` con `bank: "manual"`, `transactions: []`.

**Extracto — `src/app/components/xray/XRayLanding.tsx`** (187 líneas)

- `<input type="file" accept=".csv,.xlsx,.xls" multiple>`, `MAX_FILES = 5`, dedup por `name+size`.
- **Sin validación de tipo ni tamaño en cliente**: el drag-drop no pasa por `accept`, así que se acepta
  cualquier cosa y se codifica en base64.
- **Sin casilla de consentimiento, sin enlace a privacidad, sin aviso de retención.** Solo tres chips de
  confianza (`trustNoSignup`, `trustPrivate`, `trustDeleted`).
- POST → `/api/xray/analyze` con `{ files: [{ filename, dataBase64 }] }`.

**La bifurcación — `XRayFlow.tsx`** (11 `useState`)

`XRayStep = 'landing' | 'manual' | 'processing' | 'classify' | 'results' | 'email'`

- Manual: `landing → manual → results → email`. **Salta `processing` y `classify`.**
- Extracto: `landing → processing → (classify si gate) → results → email`.
- `reduced` (solo `true` en la ruta manual) oculta **exactamente 2 secciones**: hero y donut de
  categorías. No se persiste en servidor y **no llega al generador de PDF**.
- `gate`: `CLASSIFY_THRESHOLD = 0.10` sobre el resultado prístino.

Son dos rutas de datos paralelas de verdad, no dos vistas de una: la manual nace con un resultado
sintético a cero y la de extracto con uno real. **Es exactamente lo que el principio 1 prohíbe.**

### 1.2 Qué se guarda hoy y dónde

**No existe entidad de perfil.** `XRaySession` (`prisma/schema.prisma:453`) es lo más cercano:

`id`, `result` Json, `transactions` Json, `bank`, `txnCount`, `aiCategories` Json?, `overrides` Json?,
`email` String?, `claimedByUserId` String?, `createdAt`, `expiresAt`.

- **Sin relación a `User`, sin FK, sin campo de versión, sin campo de consentimiento, sin origen/UTM.**
- `/add-account` y `/reclassify` **sobrescriben `result` en la misma fila** → no hay historial. Una
  segunda radiografía es hoy imposible de representar.
- `SESSION_TTL_MS = 48h`, pero la expiración es **solo comprobación perezosa en lectura** (410). No
  existe ningún `deleteMany` sobre `xRaySession` en todo el repo: las filas con `transactions` en bruto
  y el email **viven para siempre**.
- Precedentes de procedencia ya en el esquema, y son el patrón a generalizar:
  `Expense.scopeSource`/`scopeConfidence`, `Account.balanceSource`/`balanceSyncedAt`,
  `Debt.balanceSource`/`balanceSyncedAt`, `CategorizationRule.source`, `Income.source`.

### 1.3 Cómo se genera el informe y si se rompe

`XRayResults.tsx` desestructura **12 campos de primer nivel** (línea 95): cualquiera ausente lanza.

Degrada bien hoy, **pero solo porque el servidor fabrica un `XRayResult` con forma completa a cero**. La
degradación es estructural (arrays vacíos, contadores a 0), no dirigida por `reduced`. Secciones **sin
guarda**: §1.6 deudas y §5 salud. Consecuencia visible en la ruta manual: el anillo de salud renderiza
**un pilar dentro de un `grid-cols-5`** y la copy llama a `debtLoad` "tu fortaleza", que con un solo
pilar es engañoso.

`server/lib/xray/pdf.ts` — `generateXrayPdf(result, lang)` **no conoce `reduced`** ni resultados
parciales. Imprime siempre las 4 tarjetas de resumen y el bloque de salud, así que a un usuario manual le
presenta cifras manuales con marco de extracto completo (una "tasa de ahorro" que en realidad es ingreso
menos deuda).

**Veredicto:** no hay composición por bloques. Hay una plantilla monolítica que se sostiene porque
alguien rellena huecos con ceros. El principio 5 (degradación con dignidad + bloque explícito de "esto no
pudimos calcularlo") exige rehacer la composición, no parchear guardas.

### 1.4 Captura de email

`XRayEmailCapture.tsx`, alcanzado desde el CTA de resultados (§7) en **ambas** rutas, siempre **después**
del informe.

- Solo email, validado con regex. **Cero casillas. Sin enlace a política de privacidad.**
- Informe (PDF) y eBook se listan como **un único paquete indiferenciado** (`email.perkReport` +
  `email.perkEbook`) → **no hay separación entre entrega transaccional y alta en lista.** Es el hueco
  RGPD principal.
- POST → `/api/xray/lead` → guarda **solo el email**. No hay `consentAt`, ni marketing, ni IP.
- `onCreateAccount` escribe `localStorage['xraySessionId']` y redirige a `/`; `AuthContext` reclama con
  `POST /api/xray/claim`.

### 1.5 El parser de extractos — veredicto honesto

**Es un parser de BBVA más una conjetura de IA.** No está listo para exports arbitrarios de bancos
españoles.

- `server/lib/parsers/` contiene **exactamente `bbva.ts` y `bbva.test.ts`**. Un solo parser.
- `SUPPORTED_BANKS = ['BBVA','Santander','CaixaBank','ING','Sabadell','Revolut']`
  (`XRayLanding.tsx:7`): **cinco de los seis no tienen código detrás.** Es copy de marketing que descansa
  en la IA. El fixture "genérico" del test está comentado como *"A Santander-like grid"* — inventado, no
  un export real.
- **Dos bugs que corrompen datos en silencio:**
  - `parseAmount` con separadores ingleses: `"1,234.56"` → `1.23456`. Un cargo de €1.234,56 se importa
    como €1,23. **Error de 1000×, sin aviso.** Afecta a Revolut/N26, que se anuncian.
  - `parseDate` asume siempre dd/mm: `12/31/2026` → `new Date(2026, 30, 12)` → **julio de 2028**,
    `isNaN` falso, fila aceptada.
- La validación del mapeo por IA (`aiColumnMap.ts:72-85`) es **puramente estructural**: entero, dentro de
  rango, y "tiene headerRow + dateCol + alguna fuente de importe". **Cero comprobación semántica**: nada
  verifica que la columna de fecha parsee como fechas ni que la de importe parsee como números. Si el
  modelo elige la columna de saldo como importe, sale un diagnóstico financiero construido sobre basura,
  entregado con total confianza.
- `readGrid`: `buffer.toString("utf8")` → **Latin-1/Windows-1252 no soportado**, y los bancos españoles
  lo emiten a diario (`Ñ`, `ó`, `€` → U+FFFD, envenenando la normalización de comercios).
- CSV: `line.split(sep)` sin parser real → **se rompe con comas dentro de comillas**
  (`"MERCADONA, MADRID"` desplaza todas las columnas).
- **Cobertura: 8 de 152 tests tocan parsing (5,3%).** `readGrid`: 0 tests. `aiColumnMap`: 0 tests.
  `parseFile`/la ruta: 0 tests. **Cero fixtures**: no hay ni un `.csv`/`.xlsx` en el repo; todos los
  tests parten de un grid escrito a mano.
- Sin límite de tamaño por fichero (solo `express.json({limit:"12mb"})` global, y **sin error handler**,
  así que un fichero grande devuelve un 413 en HTML que el cliente no sabe renderizar).
  `/add-account` **no está autenticado y no tiene rate limit**.

**Conclusión operativa:** la restricción de alcance del brief aplica. Se lanza con la ruta manual
completa y el extracto **detrás de flag, solo BBVA, etiquetado beta** — o lista de espera. Un informe
equivocado entregado con confianza es peor que no ofrecer la función.

### 1.6 Confirmación de email — qué hay ya, y por qué NO se reutiliza

Existe maquinaria OTP, pero es de la auth de la BudgetApp y **no debe reutilizarse** (§0.2). Lo documento
para justificar la decisión, no para heredarlo.

- `OtpToken` (`schema.prisma:398`): `id, email, tokenHash, type, expiresAt, used, createdAt`.
  **Sin `userId`, sin `attemptCount`, sin `consumedAt`.**
- `server/lib/otp.ts`: **5 dígitos, no 6**, generados con **`Math.random()`** (predecible), hash `sha256`
  **sin sal**, y comparación `===` **no de tiempo constante**.
- **Sin límite de intentos y sin rate limit en ningún endpoint de auth.** Fuerza bruta contra un código
  de 5 dígitos, sin techo. Lo único que existe es un enfriamiento de 60 s en `/resend-otp`.
- **No hay enlace mágico en ningún sitio.** Solo código numérico. El precedente de token en URL es
  `PartnerInvite.token` (`server/routes/partner.ts`) — útil como plantilla para el enlace de recuperación
  del perfil abandonado, que **no** es un inicio de sesión.
- Sesión: `setAuthCookie` → cookie `token`, httpOnly, sameSite lax, 7 d, HS256. **No se usa en este
  flujo**: la Radiografía no establece sesión (§0.2).
- `server/lib/mailer.ts` exporta `sendVerificationEmail`, `sendPasswordResetEmail`, `sendWelcomeEmail`,
  `sendPartnerInviteEmail`, `sendXrayReportEmail`, `sendWelcomeGoogleEmail`. `sendVerificationEmail` es la
  **plantilla** del correo de código, pero se escribe uno propio para la Radiografía: su copy habla de
  verificar una cuenta, y aquí el mensaje es "confirma para recibir tu informe".

**Lo que se hereda: nada de código. Solo dos lecciones.** Los defectos de arriba (código débil, sin
límite de intentos, sin rate limit) son exactamente los que **no** hay que repetir en la tabla propia de
§2.3. Un código adivinable rompe justo el propósito del OTP aquí: filtrar correos falsos.

### 1.7 El puente anónimo → cuenta

`server/lib/xray/hydrate.ts` — `hydrateFromXraySession(userId, sessionId)` ya existe y hace el camino
completo (crea `Allocation` por cubo, `Expense`/`Income` con `skipDuplicates`, rellena
`UserSettings.monthlyIncome` si sigue a 0, aprende `CategorizationRule`, marca `claimedByUserId` y
**borra `transactions`**). Reutilizable en concepto, con **tres defectos**:

1. **No es a prueba de fallos**: el `claim()` es lo último, así que un fallo intermedio deja la sesión sin
   reclamar y un reintento **duplica `Allocation`** (`Expense`/`Income` están protegidos por
   `@@unique([userId, externalId])`; `Allocation` no). Nada va en transacción.
2. **`POST /api/xray/claim` no verifica que `session.email === user.email`**: cualquier usuario
   autenticado que conozca un `sessionId` puede reclamarlo. **Agujero de seguridad, arreglar sí o sí.**
3. Solo cubre el camino *hacia* la BudgetApp. El brief necesita lo inverso: el perfil es la fuente y la
   cuenta se engancha a él.

### 1.8 Reutilizar vs descartar

**Reutilizar tal cual**
- `server/lib/xray/analyze.ts` y su cadena (`wealth.ts`, `income.ts`, `debts.ts`, `transferDetail.ts`,
  `reconcile.ts`, `healthIndex.ts`, `archetype.ts`) — 152 tests, verificado. Pasa a ser **un productor de
  insumos** del perfil, no el dueño del resultado.
- `server/lib/mailer.ts`: helpers ya con tablas + CSS inline (`wrapper`, `featureRow`, `ctaButton`,
  `divider`). Quitar el `<link>` a Google Fonts y el `linear-gradient` (Outlook los ignora).
- El patrón de cron autenticado de `server/routes/banking.ts:326` (`x-cron-secret` / `CRON_SECRET`) → es
  la base del job de purga.
- `PartnerInvite` + `sendPartnerInviteEmail` como plantilla del enlace de respaldo.
- `shareCard.ts`, `XRayMark.tsx`, `xray-theme.css`, y el namespace i18n `radiografia` (198 claves ya
  escritas en es+en).
- `.claude/hooks/` (el gate de `npm run verify` ya bloquea el turno).

**Descartar / reescribir — explícito**
- **`XRayQuickEstimate.tsx`**: se descarta como formulario. Captura 2 de ~14 insumos y es de una sola
  pantalla. Sobreviven el patrón de filas de deuda y `kindIcon()`.
- **La bifurcación de `XRayFlow.tsx`**: `manual` y `processing` como ramas hermanas desaparecen. Un único
  onboarding con el extracto como paso opcional dentro del Bloque 3.
- **`reduced`**: se descarta el concepto entero. Lo sustituye la completitud por campo del perfil, que es
  lo que decide qué bloque se renderiza.
- **El `XRayResult` fabricado a cero** en `/quick-estimate`: se descarta. Un resultado incompleto debe
  estar *ausente*, no a cero — hoy los ceros son indistinguibles de datos reales.
- **`pdf.ts` en el camino público**: fuera del lanzamiento (el scope pide HTML y prohíbe adjuntos). El
  fichero se conserva para v2.
- **`server/lib/otp.ts` y `OtpToken`**: **no reutilizar.** Son auth de la BudgetApp (`CLAUDE.md`: no
  modificar sin preguntar) y acoplarlos rompería la dirección única de la Épica 0. Se escribe un
  verificador propio y aislado (§2.3), sin heredar sus defectos.
- **`rateLimited()` de `xray.ts`**: descartar para el verificador. `Map` en memoria, por proceso, sin
  evicción, con IP de `x-forwarded-for` sin validar. Inservible para proteger un código.
- **Toda la maquinaria de sesión** (`setAuthCookie`, JWT, `requireAuth`) queda fuera de este flujo: no se
  construye identidad (§0.2).
- **`SUPPORTED_BANKS`**: quitar los cinco logos sin código detrás. Anunciar lo que funciona.

---

## 2. Modelo de datos objetivo

Todo **aditivo**: tablas nuevas, `db push` (nunca `migrate dev`, el historial está roto). **No se toca
`XRaySession`**, que queda degradado a área de trabajo efímera del parseo. Eso hace que el riesgo de
migración de datos existentes sea **nulo** en casi todo el diseño; lo marco por tabla.

### 2.1 Perfil canónico con procedencia por campo

El principio 3 (guardar **ambos** valores cuando discrepan) obliga a **varias filas por campo**, una por
origen. Eso descarta columnas anchas y descarta un JSON plano. Va en tabla hija:

```
FinancialProfile
  id              String   @id @default(cuid())
  anonId          String?  @unique   // cookie opaca antes del email
  email           String?  @unique   // clave de unión; null mientras es anónimo
  emailVerifiedAt DateTime?
  claimedByUserId String?  @unique   // FK lógica a User cuando se registra
  currency        String   @default("EUR")
  incomeType      String   @default("regular")  // regular | irregular
  onboardingStep  String?               // progreso parcial (§2.6)
  onboardingCompletedAt DateTime?
  consentReportAt      DateTime?        // §4.3, dos consentimientos independientes
  consentMarketingAt   DateTime?
  consentMarketingRevokedAt DateTime?
  origen          String?               // utm_source
  stageCache      String?               // CACHÉ, nunca fuente de verdad (principio 4)
  stageCacheAt    DateTime?
  lastSeenAt      DateTime  @updatedAt  // base de la retención de 30 días
  createdAt       DateTime  @default(now())

ProfileFieldValue
  id         String   @id @default(cuid())
  profileId  String
  fieldKey   String                    // del registro versionado (§2.2)
  valueCents Int                       // entero, nunca Float (CLAUDE.md)
  source     String                    // manual | extracto | derivado
  capturedAt DateTime @default(now())
  @@unique([profileId, fieldKey, source])   // un valor vigente por campo Y origen
  @@index([profileId])
```

- **Discrepancia = dos filas con el mismo `fieldKey` y distinto `source`.** No se resuelve al escribir; la
  lee el informe y la convierte en sección (principio 3).
- El **valor canónico resuelto** por campo sale de una regla de precedencia declarada, no de un `UPDATE`.
  La regla concreta es decisión de producto → **Q6**.
- **Completitud calculada**, no almacenada: `presentes(requeridos) / requeridos` según el registro.

Las deudas necesitan tabla propia (son N, tipadas, con interés):

```
ProfileDebt
  id                 String  @id @default(cuid())
  profileId          String
  kind               String  // consumo_caro | coche_estudios | hipoteca | otra
  monthlyPayment     Int     // céntimos
  outstandingBalance Int?
  apr                Float?  // clave para la banda de "consumo caro"
  source             String  // manual | extracto | derivado
  capturedAt         DateTime @default(now())
  @@index([profileId])
```

> Ojo: el `DebtKind` que ya existe (`credit_card|installment|bnpl|payday_loan|auto_loan|other`) **no
> tiene `hipoteca`** y no coincide con la taxonomía del motor. Hace falta una correspondencia explícita,
> no un renombrado → **Q7**.

**Los tres cubos de activos** son tres `fieldKey` del registro, no una tabla: `assets_cuasi_efectivo`,
`assets_mercado_volatil`, `assets_bloqueado`, más `account_balance`. Se persisten los tres desde el día
uno aunque el motor ignore `bloqueado` en las etapas iniciales.

**Riesgo de migración:** ninguno. Tablas nuevas. Nada existente las lee.

### 2.2 Registro de campos e insumos mínimos

El registro es **configuración versionada en código** (`server/lib/radiografia/fields/registry.v1.ts`),
no filas: lo consumen validación, completitud y los predicados del motor, y debe versionarse con ellos.

Por campo: `key`, `bucket` (ingreso/vivienda/esenciales/disfrute/ahorro/inversión/generosidad/activos),
`required: boolean`, `block` (1|3), `unit` (cents), `derivable_from?`.

**Insumos mínimos para clasificar etapa** (el motor no corre sin ellos): ingreso, gastos esenciales,
vivienda, deudas (o "no tengo"), `account_balance`, `assets_cuasi_efectivo`. Los demás enriquecen.

**Qué pasa cuando faltan:** el motor devuelve
`{ classifiable: false, missing: ['essentials', ...], partial: {...} }`. Nunca inventa una etapa. La
pantalla y el informe muestran el bloque explícito de "esto no pudimos calcularlo todavía, y por qué"
listando `missing` en lenguaje humano (principio 5).

### 2.3 Confirmación de email (sin identidad)

Tabla propia y aislada, **sin tocar `OtpToken`** (§0.2). Nada de sesión, nada de `User`:

```
RadiografiaEmailCheck
  id           String   @id @default(cuid())
  profileId    String
  email        String                  // el que se está confirmando
  codeHash     String                  // sha256(código + sal por fila)
  salt         String
  expiresAt    DateTime                // 15 min
  attemptCount Int      @default(0)    // se invalida al 5º
  consumedAt   DateTime?
  createdAt    DateTime @default(now())
  @@index([profileId])
  @@index([email, createdAt])          // base del rate limit y del enfriamiento
```

- **Código de 6 dígitos** con `crypto.randomInt`, hash **con sal por fila**, comparación de **tiempo
  constante** (`crypto.timingSafeEqual`). Un código adivinable anula el único propósito del OTP aquí:
  filtrar correos falsos.
- Expiración **15 min**. **Máximo 5 intentos**, luego se invalida y hay que pedir otro. Reenvío con
  **enfriamiento de 60 s** por email.
- **Rate limit respaldado en DB**, no en memoria: por email y por IP sobre una ventana. Se cuenta con
  `@@index([email, createdAt])`; nada de `Map` de proceso (§1.8).
- **Al confirmar**: se fija `profile.emailVerifiedAt`, se marca `consumedAt`, y se devuelve el **token de
  capacidad** de esa radiografía (§0.2). **No se emite cookie de sesión ni JWT.**

```
RadiografiaAccessToken
  token      String   @id            // opaco, alta entropía; va en la URL del informe y en el reanudar
  profileId  String
  scope      String                  // 'resume' | 'report'
  expiresAt  DateTime?               // 'resume' caduca; 'report' puede ser permanente
  createdAt  DateTime @default(now())
  @@index([profileId])
```

Un token de capacidad **no autentica a una persona**: da acceso a *una* radiografía. Es lo que permite
retomar el formulario y lo que protege la URL del informe, sin construir cuentas.

**Riesgo de migración:** ninguno. Dos tablas nuevas; `OtpToken` y la auth existente quedan intactas.

### 2.4 Radiografías como instantáneas versionadas

```
Radiografia
  id                  String   @id      // token no adivinable (URL del informe)
  profileId           String
  version             Int
  computedAt          DateTime @default(now())
  resultado           Json               // porcentajes, umbrales activados, bloques calculables
  stageAtComputation  String?
  frameworkVersion    Int                // versión del 10/50/20/20 usado
  engineConfigVersion Int                // versión del motor de etapas usado
  origen              String?
  @@unique([profileId, version])
  @@index([profileId, computedAt])
```

Inmutable: nunca se sobrescribe. Una segunda radiografía a los 3 meses es `version: 2` y la comparación
de progreso es un `diff` entre dos filas. Guardar `frameworkVersion` y `engineConfigVersion` es lo que
permite explicar por qué una radiografía antigua decía otra cosa (los criterios se van a reescribir).

**Riesgo de migración:** ninguno (tabla nueva). Los `XRaySession` existentes **no se backfillean**: son
efímeros de 48 h por diseño y su `result` tiene otra forma. Único cuidado real: hay filas con **email
capturado** que son leads; conviene **exportarlos una vez** antes de que la purga nueva empiece a borrar.
Es la única acción de datos con valor de negocio en toda esta migración.

### 2.5 Camino lead anónimo → perfil → cuenta reclamada

1. **Anónimo**: se crea `FinancialProfile` con `anonId` (cookie opaca httpOnly). Bloque 1 escribe
   `ProfileFieldValue` con `source: manual`. Sin email todavía → parciales solo en `sessionStorage` del
   navegador (mientras no hay email confirmado no hay base legítima para guardar en servidor).
2. **Con email confirmado** (Bloque 2): se fija `email` + `emailVerifiedAt`, se devuelve el token de
   capacidad `resume`, y **desde ahí cada paso guarda parcial en servidor**. Si el email ya tiene perfil,
   se **fusiona** por `fieldKey` conservando procedencia (no se pisa: entra como otra fila `source`).
   Sin sesión: la continuidad la da el token, no un login.
3. **Cuenta reclamada** (**fase 2, nada de esto se construye ahora**): cuando esa persona se registre en
   la app, se localiza el perfil por `email` y se fija `claimedByUserId`. **No vuelve a introducir nada.**
   Hoy `claimedByUserId` existe en el esquema pero **nadie lo escribe**.

El paso 3 se diseña ahora pero **se implementa en la fase 2**. Cuando llegue, se reutiliza la *idea* de
`hydrate.ts` invertida (el perfil es la fuente, no la sesión) y con los tres defectos de §1.7 corregidos:
transacción, clave de idempotencia, y **verificar que el email coincide** antes de reclamar.

**Aparte, y para el 12 sep:** el agujero de `POST /api/xray/claim` (§1.7, punto 2) hay que cerrarlo
igualmente, no porque este plan lo use, sino porque hoy está expuesto en producción. La vía barata es que
la Épica 0 lo deje **detrás del flag de la BudgetApp**, donde nunca debió salir.

### 2.6 Progreso parcial

Dos columnas en `FinancialProfile` (`onboardingStep`, `onboardingCompletedAt`) en vez de tabla aparte: es
un único valor mutable por perfil, sin historial que interese. `lastSeenAt` (ya `@updatedAt`) es la base
de la retención de 30 días y del correo de recuperación del perfil 3 (abandono con email).

### 2.7 Historial de transiciones de etapa

```
StageTransition
  id                  String   @id @default(cuid())
  profileId           String
  fromStage           String?
  toStage             String
  reason              String     // month_close | threshold_cross | new_radiografia | manual
  engineConfigVersion Int
  inputsSnapshot      Json       // los insumos exactos que produjeron la transición
  occurredAt          DateTime @default(now())
  @@index([profileId, occurredAt])
```

Desde el día uno, como pide el brief. `inputsSnapshot` es lo que permite auditar una transición cuando
los criterios ya han cambiado dos veces.

---

## 3. Motor de clasificación de etapa

### 3.1 Forma: configuración versionada, no `if`s

```
StageEngineConfig
  id          String   @id @default(cuid())
  version     Int      @unique
  config      Json
  publishedAt DateTime?
  isActive    Boolean  @default(false)
```

Semilla desde `server/lib/radiografia/stage/config.v1.json` (versionado en git), cargable a DB para
editar sin desplegar. Un evaluador puro lo interpreta: `evaluateStage(inputs, config) → StageResult`.

### 3.2 Predicados declarativos (sin `eval`)

```json
{ "all": [
    { "field": "cashflow_net", "op": "<", "value": 0 },
    { "any": [ { "field": "debt_consumo_caro_total", "op": ">", "value": 0 } ] }
] }
```

Operadores cerrados: `<, <=, >, >=, ==, !=, between`. `field` solo puede referenciar claves del objeto
`StageInputs` (derivado y documentado), nunca rutas arbitrarias. Un predicado que referencia un campo
ausente **no evalúa a falso**: devuelve `unknown` y propaga a `classifiable: false` con ese campo en
`missing`. Confundir "no lo sé" con "no cumple" es el error que clasificaría mal a media base.

### 3.3 Estructura por etapa

```json
{ "id": "etapa_1", "order": 1,
  "entry":  { /* predicado */ },
  "exit":   { /* predicado */ },
  "goal":   { "id": "...", "copyKey": "radiografia.goal...." },
  "unlocks": ["..."],
  "branches": [
    { "id": "flujo_caja_negativo",
      "when": { "field": "cashflow_net", "op": "<", "value": 0 },
      "goal": { "id": "cerrar_la_brecha", "copyKey": "..." } }
  ] }
```

**Todos los umbrales quedan como `"PENDIENTE_DEFINIR"`** en `config.v1.json`. No se inventan valores; la
estructura queda lista y arranca con `classifiable: false` hasta que se rellenen (→ **Q1**).

### 3.4 Lo que el diseño contempla

- **Flujo de caja negativo**: `branches` dentro de la etapa inicial, con meta propia
  (`cerrar_la_brecha`), no la meta de colchón. Es una rama, no una etapa.
- **Deuda desagregada**: los insumos exponen `debt_consumo_caro_total`, `debt_coche_estudios_total`,
  `debt_hipoteca_total`, `debt_max_apr` y conteos. Nunca un único "deuda total".
- **Ingreso irregular**: `incomeType` en el perfil. Para `irregular`, los predicados usan `income_floor`
  (un suelo conservador), no la media. La regla del suelo es decisión de producto → **Q3**.
- **Colchón y fondo de emergencias son DOS cosas distintas, en dos etapas distintas.** No confundirlas es
  lo que evita construir el motor al revés:

  | | **Colchón** | **Fondo de emergencias** |
  |---|---|---|
  | Cuándo | **Antes** del plan de pago de deudas | **Después** de liquidar las deudas |
  | Función | Conductual: que una emergencia no empuje a la tarjeta de crédito | Financiera: aguantar una pérdida de ingreso |
  | Objetivo | **0,5 × base mensual**, y el usuario solo puede **subirlo** | **3 × base mensual** como mínimo duro; solo puede subirlo |
  | Quién lo fija | Sistema sugiere 0,5; usuario ajusta al alza | Sistema fija el mínimo; usuario ajusta al alza |

  **`base_mensual` = vivienda + gastos esenciales.** Nada de disfrute ni de cuotas. Es lo que se necesita
  en modo supervivencia: si desaparece el ingreso, lo primero que se corta es el disfrute. Una sola
  definición para los dos objetivos, para no explicarle al usuario dos denominadores distintos.

  > Es la **misma magnitud** que el cubo "esenciales" del 10/50/20/20, no una segunda definición paralela.
  > Se calcula una vez en `StageInputs` y se referencia desde ahí — `CLAUDE.md` prohíbe re-derivar un
  > umbral en dos sitios.

  Ambos objetivos se expresan como **fracción de `base_mensual`**, nunca como importe fijo: así se
  autoajustan a cualquier país e ingreso y no hay tabla España/Latam que mantener y que envejezca.

  Con 2.000 € de esenciales y 1.000 € de disfrute: **colchón 1.000 €**, **fondo 6.000 €**.

  **La sugerencia del colchón es igual a su suelo (0,5), a propósito.** El colchón es deliberadamente
  pequeño: su trabajo es llegar rápido al pago de deudas, no acumular. Sugerir 1 mes retrasaría el arranque
  del plan justo en la etapa donde la inercia hace más daño.

  **Interacción con flujo de caja negativo:** si los gastos superan el ingreso, el objetivo del colchón es
  inalcanzable por definición. No es un caso a parchear — esa persona cae en la rama `flujo_caja_negativo`,
  cuya meta es *cerrar la brecha*, no juntar el colchón.

  Ambos se cubren con el **mismo cubo** (`account_balance + assets_cuasi_efectivo`); lo que cambia es el
  objetivo vigente según la etapa. Variables separadas en `StageInputs`: `colchon_objetivo`,
  `colchon_ratio`, `fondo_objetivo`, `fondo_ratio`.

- **Los tres cubos**:
  - `buffer_disponible = account_balance + assets_cuasi_efectivo`. **Nunca** el total de activos. Es el
    numerador tanto del colchón como del fondo.
  - `assets_mercado_volatil` **no** suma a ninguno de los dos, pero entra en `StageInputs` y **altera la
    recomendación** (caso de conflicto).
  - `assets_bloqueado` se persiste y se expone en los insumos, pero ninguna etapa inicial lo referencia.
    Está en el esquema desde el día uno.

- **Suelo protegido: es dependiente de la etapa, no una constante.** No es una meta con fecha, es una
  restricción que sale del motor: `{ protectedFloorCents, appliesTo: ['cuasi_efectivo'] }`. Su valor es el
  objetivo **de la etapa vigente** — durante el pago de deudas el suelo es el colchón (protegerlo es
  literalmente su propósito); una vez liquidadas, el suelo crece hasta el fondo de emergencias. Ninguna
  meta puede consumirlo, y nunca se aplica sobre `mercado_volatil`.
- **Caso de conflicto `mercado_volatil` alto + deuda de consumo caro**: entrada de primer nivel en la
  config, evaluada **antes** de la meta genérica y que la **sustituye**:
  ```json
  "conflicts": [ { "id": "volatil_con_deuda_cara",
    "when": { "all": [
      { "field": "assets_mercado_volatil", "op": ">", "value": "PENDIENTE_DEFINIR" },
      { "field": "debt_consumo_caro_total", "op": ">", "value": "PENDIENTE_DEFINIR" } ] },
    "recommendation": { "copyKey": "..." } } ]
  ```
  Es un problema de decisión de asignación, no de falta de ahorro, y el informe debe decirlo así.
  Umbral → **Q4**.
- **Recálculo por evento, no continuo**: `recalculateStage(profileId, reason)` se dispara solo en
  `month_close` (hay `UserSettings.cycleStartDay`, pero un perfil sin cuenta no lo tiene → **Q8**),
  `threshold_cross`, `new_radiografia` y `manual`. `stageCache` sirve las lecturas; nunca es la verdad.
- **Historial**: cada cambio escribe `StageTransition` (§2.7).

### 3.5 Dónde vive

**En el servidor**: `server/lib/radiografia/stage/`. Motivo técnico duro: `tsconfig.server.json` fija
`rootDir: "server"`, así que **el servidor no puede importar de `src/`**. Y el motor tiene que ser
autoritativo porque alimenta el informe por correo y, en fase 2, las metas de la app. El teaser del
Bloque 4 llega por respuesta de API, no por cálculo en cliente.

> Esto **cambia el enfoque del 11 ago**, cuando se planificó que el cliente calculara los porcentajes
> para que los importes no salieran del navegador. Con perfil canónico persistido (C2) esa protección ya
> no aplica: los importes van al servidor por diseño. Los controles compensatorios pasan a ser §4.

### 3.6 Encaje de los tres modelos (propuesta, no decisión)

Hay tres modelos y sobra uno (C3). Encaje limpio sin tirar nada:

- **10/50/20/20** → capa de **insumos**. Produce los porcentajes por área que los predicados consumen.
- **5 etapas** → la **columna vertebral**. Decide la meta única activa. Es lo que el brief pide.
- **7 arquetipos** → capa de **presentación**. Etiqueta de identidad derivada de los mismos insumos, para
  el titular del teaser y la tarjeta compartible. No decide nada.

Requiere confirmación → **Q2**.

---

## 4. Cumplimiento RGPD (bloqueante)

### 4.1 Extracto: procesar y borrar — dónde se garantiza en el código

- **El fichero nunca toca disco hoy**: llega en base64 dentro del JSON, no hay `multer` ni `fs.writeFile`
  en toda la ruta. Eso ya cumple, y hay que **documentarlo** para que nadie introduzca un `multer` por
  comodidad.
- **El problema real son las filas parseadas**, no el fichero: `storableTxns()`
  (`server/routes/xray.ts:93`) persiste fecha, concepto, importe firmado y saldo en
  `XRaySession.transactions` durante 48 h. Es el mismo dato personal en otra forma.
- **El punto exacto donde se garantiza:** `storableTxns()` es la única función que escribe movimientos. El
  plan la reduce a un **área de trabajo de TTL corto (60 min, no 48 h)** con purga real, y **prohíbe que
  los movimientos entren en `FinancialProfile`**: al perfil solo llegan **agregados** como
  `ProfileFieldValue` con `source: extracto`.
- Se conserva un área de trabajo (no cero persistencia) porque `/reclassify` y `/add-account` necesitan
  las filas. La alternativa (cliente sostiene y reenvía) es más pura pero rehace el flujo de
  reclasificación entero; no cabe antes del 12 sep.

### 4.2 Aviso en el componente de subida

Hoy `XRayLanding.tsx` tiene tres chips y **ningún aviso de borrado**. Va texto explícito **junto al
control de subida**, no solo en la política: *"Tu archivo se procesa y se borra. Guardamos solo los
totales, nunca tus movimientos."* Claves i18n nuevas en es+en (el hook de paridad ya lo verifica).

### 4.3 Consentimientos separados

Hoy hay **cero casillas** y el informe y el eBook se ofrecen como un paquete único. Pasa a:

- **Casilla 1 — informe** (necesaria para prestar el servicio): explícita, sin premarcar.
- **Casilla 2 — lista de correo** (opcional): independiente, sin premarcar. **Nunca una sola casilla.**
- Se persisten `consentReportAt` / `consentMarketingAt` (+ `consentMarketingRevokedAt`) en el perfil.
- Enlace a política de privacidad junto a las casillas, y enlace de baja en el pie de cada correo.

### 4.4 Retención de parciales nunca completados

**30 días desde `lastSeenAt`** para perfiles con `onboardingCompletedAt == null`. Mecanismo:
`POST /api/internal/purge` autenticado con `x-cron-secret` / `CRON_SECRET` — **exactamente el patrón que
ya existe** en `server/routes/banking.ts:326` — invocado por cron externo. Borra en cascada:
`ProfileFieldValue`, `ProfileDebt`, `Radiografia`, `StageTransition`, `RadiografiaEmailCheck`,
`RadiografiaAccessToken`, y el `FinancialProfile`. **`OtpToken` no se toca** — es de la auth de la
BudgetApp (§0.2). El mismo job purga `XRaySession` vencidas (los 60 min de §4.1), que hoy **no se borran
nunca**.

Si se acepta Q12(b), los perfiles **con email escrito pero sin confirmar** (`emailVerifiedAt == null`)
usan una retención más corta y agresiva: **7 días**, no 30.

### 4.5 Borrado a petición

`POST /api/radiografia/forget`, alcanzable desde el pie del correo y desde la página del informe,
confirmado con el mismo mecanismo de OTP (no basta con conocer el email). Borra el perfil y todo lo
dependiente. Se puede conservar una lápida anonimizada (solo `createdAt` + contadores) si hace falta no
falsear la analítica; sin email, sin importes.

---

## 5. Plan de desarrollo por fases (dependencia técnica)

**Leyenda de lanzamiento:** 🔴 imprescindible 12 sep · 🟡 detrás de flag · ⚪ post-lanzamiento

| Fase | Qué entra | Requiere | Desbloquea | Verificación | 12 sep |
|---|---|---|---|---|---|
| **F0** Higiene + aislamiento | Commitear los 33 ficheros, ramas por épica, `VITE_ENABLE_BUDGETAPP` en front y back, rutas públicas explícitas, rate limit en los 5 endpoints sin él, `robots.txt` | — | Todo | `/api/plans` → **404** (no 401); la Radiografía funciona con el flag apagado | 🔴 |
| **F1** Modelo canónico | `FinancialProfile`, `ProfileFieldValue`, `ProfileDebt`, `Radiografia`, `StageEngineConfig`, `StageTransition`; registro de campos v1; `db push` | F0 | F3, F4, F5 | Un perfil con dos valores del mismo `fieldKey` y distinto `source` persiste ambos; completitud calculada correcta | 🔴 |
| **F2** Confirmación de email | `RadiografiaEmailCheck` + `RadiografiaAccessToken`; código de 6 dígitos (`crypto.randomInt`, sal, comparación constante); 5 intentos; rate limit en DB; correo de código propio. **Sin sesión, sin login, sin tocar `OtpToken`** | F1 | F3 (parciales) | Código caduca a 15 min; se invalida al 5º intento; fuerza bruta cortada; **no se emite cookie de sesión** | 🔴 |
| **F3** Shell del onboarding | Máquina de pasos única (4 bloques) que sustituye la bifurcación; `sessionStorage` antes del email, parciales en servidor después vía token de capacidad; volver atrás sin pérdida; sobrevive a refresco | F1, F2 | F4, F10, F11 | Refrescar en cualquier paso no pierde datos; con el token, el parcial se retoma **en el mismo navegador** (no hay reanudación entre dispositivos — §0.2) | 🔴 |
| **F4** Bloque 1 + 3 cubos | Ingresos (regular/irregular), deudas tipadas, gastos, y **los tres cubos de activos** como campos opcionales-con-cero | F1, F3 | F5, F6 | Un usuario sin inversiones responde 0 en dos cubos **sin pasos extra**; todo acepta 0 y muestra separador de miles | 🔴 |
| **F5** Motor de etapas v0 | Evaluador puro + `config.v1.json` con umbrales `PENDIENTE_DEFINIR`; insumos derivados; ramas, conflictos, suelo protegido; `StageTransition` | F1, **Q1–Q4** | F6, F7 | Con umbrales sin definir → `classifiable: false` y `missing` poblado, nunca una etapa inventada; tests del evaluador | 🔴 |
| **F6** Teaser en pantalla | **Exactamente 3 elementos**: puntuación, categoría (etapa) y frase del arquetipo. Nada de porcentajes ni fugas. Reutiliza `health.score` + `archetypeLabel/Description` | F4, F5 | F7 | Se ve el teaser sin abrir el correo; **no** se filtra ningún desglose; si no es clasificable, dice por qué en vez de mostrar un cero | 🔴 |
| **F7** Informe detallado por bloques | Composición por bloques que se renderizan solo si sus insumos existen + bloque explícito de no-calculable; sección de discrepancias manual vs extracto; página permanente en URL con token **accesible solo desde el correo** + `@media print` | F5, F6 | F8 | Dos perfiles muy distintos dan informes claramente distintos; un perfil incompleto no muestra ceros como si fueran datos; la URL no es adivinable | 🔴 |
| **F8** Entrega + consentimientos | HTML con tablas/CSS inline + texto plano; eBook como **enlace**; dos casillas; baja en el pie; SPF/DKIM/DMARC | F2, F7 | — | Llega en <2 min; correcto en Gmail móvil/escritorio, Outlook, Apple Mail; no cae en spam en 3 proveedores | 🔴 |
| **F9** Controles RGPD | Job de purga (`x-cron-secret`), TTL 60 min del área de trabajo, aviso en el componente de subida, borrado a petición | F1, F2 | — | Una fila vencida desaparece tras ejecutar la purga; el borrado elimina perfil y dependientes | 🔴 |
| **F10** Bloque 3 enriquecimiento | Desglose fino de gastos | F3 | — | Los campos finos entran como `ProfileFieldValue` sin romper la completitud | 🟡 |
| **F11** Extracto opcional | Subida **dentro del Bloque 3**, detrás de flag, **solo BBVA**, etiquetada beta, o lista de espera | F3, F10 | — | Con el flag apagado no hay rastro en el bundle; con él, un export real de BBVA produce agregados con `source: extracto` | 🟡 |
| **F12** Endurecer el parser | Arreglar `parseAmount` (1000×) y `parseDate` (dd/mm), encoding Latin-1, CSV real con comillas, validación **semántica** del mapeo IA, fixtures reales, topes de coste de IA | F11 | Ampliar bancos | Fixtures de exports reales de ≥2 bancos pasan de punta a punta; los dos bugs con test de regresión | ⚪ |
| **F13** Landing luisvespa.com | Hero + el por qué + CTA/pie; OG, favicon, HTTPS | F0 | — | <2 s en 4G; CTA a la radiografía ≥2 veces | 🔴 |
| **F14** Medición | Plausible en ambos dominios; 5 eventos con `paso_completado` numerado; UTM | F3 | — | Los 5 eventos aparecen tras una prueba completa | 🔴 |

**Prerrequisitos duros:** F0 antes de todo · F1 antes de F3/F4/F5 · F2 antes de parciales (F3) ·
**F5 está bloqueado por Q1–Q4: sin los umbrales no hay motor**, y F6/F7 dependen de F5. Es la dependencia
más crítica del plan y la única que no se puede desbloquear desde el código.

**Detrás de feature flag:** el onboarding v2 completo (puede convivir con el flujo actual), F10, F11, y la
versión del motor (`StageEngineConfig.isActive` permite cambiar criterios sin desplegar).

### 5.1 eBook: mismo correo o segundo correo — recomendación

**En el mismo correo del informe, con el eBook como enlace de descarga.** Argumentos, en orden de peso:

0. **Ya hay dos correos.** Con la confirmación OTP el flujo envía inevitablemente **código + informe**. Un
   tercer correo para el eBook convierte un alta en una ráfaga de tres mensajes en minutos. Es la razón
   más fuerte, y no existía antes de fijar el OTP.
1. **Entregabilidad.** El dominio de envío es nuevo y su reputación es cero. El correo de OTP es
   **transaccional y crítico** (sin él no hay lead): cada envío adicional que compita por esa reputación
   es riesgo puesto sobre el único correo que no puede fallar.
2. **Está fuera de scope.** `scope-release.md` excluye explícitamente *"Secuencia de nutrición de más de 1
   email"*. Un segundo correo **es** el primer paso de una secuencia de nutrición.
3. **Medición.** La métrica 4 de la Épica 4 es *% de clic en el enlace del eBook*. Un solo correo da un
   denominador sin ambigüedad; con dos no se sabría si un no-clic fue desinterés o no-entrega del segundo.

El argumento a favor de separarlo (un segundo punto de contacto para reengancharse) es real, pero
pertenece a v2: hoy no hay secuencia detrás a la que engancharlo, así que se compra un reengagement que
no se puede aprovechar.

### 5.2 Realidad del calendario

Quedan 29 días. F0 llega **un día tarde** y el brief añade F1+F2+F3 (modelo canónico + confirmación de
email + shell), que el scope congelado excluía (C1). Sigue siendo trabajo nuevo sobre un calendario
apretado, pero **descartar la identidad recorta F2 a una fracción**: se cae la sesión, el login, el enlace
mágico de acceso, el endurecimiento de JWT y toda la UI de cuenta. Estimo **2–3 días recuperados**, que es
justo el margen que faltaba.

Palancas honestas, en el orden en que se usarían:
1. **F11 a lista de espera** (no BBVA-only): quita F10+F11 del camino crítico. El parser no está listo
   (§1.5) y se ganan ~3 días.
2. **F13 reducida a hero + CTA**, como el propio scope prevé.
3. **F10 fuera** del 12 sep.

Lo que **no** se recortaría: F2 (aunque sea pequeña, un código débil o sin límite de intentos anula su
único propósito — filtrar correos falsos) ni F9 (RGPD es bloqueante y hoy no hay ni una casilla ni una
purga).

---

## 6. Preguntas abiertas — decisiones de product owner

**Bloquean F5, y por tanto F6 y F7:**

- **Q1 · Los 5 criterios de etapa.** Para cada etapa: condición de entrada, meta única, criterio de
  salida, qué desbloquea. Quedan como `PENDIENTE_DEFINIR` en `config.v1.json`; sin ellos el motor
  devuelve `classifiable: false` siempre.
- **Q2 · ¿Cuál es la columna vertebral?** Confirmar el encaje de §3.6 (10/50/20/20 = insumos · 5 etapas =
  decisión · arquetipos = presentación) o decir cuál sobra. Hay tres modelos diagnósticos y el informe no
  puede hablar con tres voces.
- **Q3 · Ingreso irregular.** ¿Qué es `income_floor` para un autónomo: mínimo declarado por el usuario,
  percentil 25 de los últimos N meses, o media menos una desviación? ¿Cuántos meses pide el formulario?
- **Q4 · Umbral del conflicto** `mercado_volatil` alto + deuda de consumo caro. ¿A partir de qué importe
  (o qué ratio respecto a la deuda) se considera conflicto y sustituye la meta genérica?
- **Q5 · CERRADA (14 ago).** Colchón y fondo de emergencias son etapas distintas;
  `base_mensual = vivienda + esenciales`; colchón `0,5 × base` (sugerencia = suelo, solo al alza); fondo
  `3 × base` (mínimo duro, solo al alza); ambos como fracción, nunca importe fijo. Suelo protegido
  dependiente de la etapa. **Documentado en §3.4** — no se re-decide aquí.

**Bloquean el modelo de datos (F1):**

- **Q6 · Precedencia manual vs extracto.** Cuando discrepan, ¿cuál es el valor canónico resuelto para
  cálculo? Propuesta: extracto para gasto (observado), manual para ingreso (el usuario conoce su neto
  mejor que un extracto de un solo mes). Los dos se guardan siempre; esto solo decide con cuál se calcula.
- **Q7 · Taxonomía de deuda.** El `DebtKind` existente
  (`credit_card|installment|bnpl|payday_loan|auto_loan|other`) **no tiene hipoteca** y no coincide con la
  del motor (`consumo_caro|coche_estudios|hipoteca|otra`). ¿Correspondencia explícita, o el motor
  clasifica por APR y el `kind` es solo etiqueta? ¿Qué APR marca "consumo caro"?
- **Q8 · Cierre de mes para un perfil sin cuenta.** `UserSettings.cycleStartDay` existe pero un perfil
  anónimo no tiene `UserSettings`. ¿Día fijo (día 1), el día que hizo la radiografía, o se pregunta?

**Bloquean el alcance del 12 sep (C1–C3 de §0):**

- **Q9 · ¿Gana el brief o gana el scope congelado?** Ya reducido: sin identidad, "cuentas de usuario" y
  "login" dejan de estar en juego. Siguen en pie el **historial de radiografías** (C1) y el **perfil con
  importes en bruto** (C2), ambos explícitamente fuera de `scope-release.md`. Si gana el brief, hay que
  reescribir su sección FUERA DE SCOPE y asumir el coste de calendario de §5.2.
- **Q10 · Extracto el 12 sep: BBVA-only detrás de flag, o lista de espera?** Recomendación: lista de
  espera, por §1.5. Decidirlo ahora cambia si F10/F11 entran en el camino crítico.
- **Q11 · El eBook.** ¿Dónde vive el fichero de *Tu Plan de Restauración Financiera* y quién lo sirve?
  Hace falta una URL estable con seguimiento de clics para la métrica 4.
- **Q12 · ¿Qué pasa si no confirma el código?** Tiene el email escrito y los datos del Bloque 1 en el
  navegador. Tres opciones, y cambian qué es un lead:
  **(a)** no se persiste nada hasta confirmar — el más limpio en RGPD, pero pierdes al perfil 3 entero;
  **(b)** se persiste el perfil marcado como no verificado y se le puede reenviar el código — recuperas
  abandonos, pero guardas datos financieros de un email no probado;
  **(c)** se persiste solo el email sin los importes, para reenviar el código.
  Mi recomendación es **(b) con retención corta y agresiva** (7 días, no 30, mientras
  `emailVerifiedAt == null`), porque el perfil 3 es explícitamente uno de los tres perfiles esperados del
  brief. Afecta a §4.4.
- **Q13 · ¿El enlace de recuperación del perfil abandonado entra el 12 sep?** Es el correo que rescata al
  perfil 3 con un token de capacidad. Depende de Q12(b) y es lo más cercano a "nutrición" que quedaría en
  el lanzamiento, lo que roza el FUERA DE SCOPE del scope congelado.
