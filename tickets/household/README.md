# Épica — Finanzas para Parejas y Hogares

> Documento de diseño (PM + UX + Arquitectura). Entregable de planificación; no es código.
> Se enmarca como **delta** sobre el modelo actual, no greenfield.

## 0. Punto de partida (qué existe hoy)

| Capacidad actual | Implementación |
|---|---|
| Pareja = "pool fusionado" | `UserSettings.linkedUserId` (secundario → primario). `req.userId` = pool compartido (id del primario para ambos); `req.authUserId` = persona real. |
| Atribución por persona | `Account.ownerUserId`, `Income.ownerUserId`. **`Expense` carece de pagador/owner** (gap). |
| Enlace de pareja | `PartnerInvite` + `partnerRouter` (invite/accept/unlink). |
| Cuentas | `Account.type` = checking\|savings\|cash\|investment\|card; `currentBalance`. |
| Objetivos | `LifePlan` colgado de `userId` (pool); sin contribución por miembro. |
| IA | Clasificación de gastos por comercio (Fase J), recurrentes (Fase F). |

**Limitaciones de hoy:** no hay entidad `Household`; el "pool" asume una visión totalmente compartida (sin niveles de privacidad); no se separa *quién paga* / *quién se beneficia* / *cómo se reparte*; no hay contribución proporcional ni balances "quién debe a quién"; los objetivos no atribuyen aportación por persona.

**Decisión arquitectónica raíz:** sustituir el hack "fusionar en el pool del primario" por una entidad **`Household`** de primera clase con **membresía**, manteniendo la **propiedad del dato por persona**. El `userId`-pool actual se mapea al **scope de hogar**.

---

## 1. Épicas

Cada épica tiene su ticket de fase (alcance implementable, dependencias, criterios):

| # | Épica | Ticket | MVP/V2 | Depende de |
|---|---|---|---|---|
| **H1** | Hogar y Membresía | [H1](./H1-hogar-membresia.md) | MVP | — |
| **H2** | Propiedad y tipos de cuenta | [H2](./H2-cuentas-propiedad.md) | MVP | H1 |
| **H3** | Atribución de transacciones | [H3](./H3-atribucion-transacciones.md) | MVP | H1, H2 |
| **H4** | Modelos financieros + contribución + balances | [H4](./H4-modelos-financieros.md) | MVP | H3 |
| **H5** | Privacidad y visibilidad | [H5](./H5-privacidad-visibilidad.md) | MVP (parcial) | H1 |
| **H6** | IA familiar (scope/ingresos/anomalías/recom.) | [H6](./H6-ia-familiar.md) | MVP + V2 | H3, H4 |
| **H7** | Objetivos familiares | [H7](./H7-objetivos-familiares.md) | V2 | H1, H4 |
| **H8** | Dashboard familiar | [H8](./H8-dashboard-familiar.md) | MVP | H4, H5 |

**Orden de implementación MVP:** H1 → H2 → H3 → H4 → H5 → H8 (+ H6 scope). H6 (resto), H7 y `global_only`/Settlement → V2.

---

## 2. Historias de usuario (selección por épica)

**H1 — Hogar**
- Como usuario, quiero **crear un hogar** e **invitar a mi pareja** por email, para gestionar el dinero juntos.
- Como invitado, quiero **unirme a un hogar** y elegir qué cuentas comparto, para controlar mi privacidad.
- Como miembro, quiero **salir de un hogar** y que mis datos personales me sigan, para no perder mi historial.

**H2 — Cuentas**
- Como miembro, quiero marcar cada cuenta como **personal o de hogar** y su **visibilidad**, para decidir qué ve mi pareja.

**H3 — Atribución**
- Como pagador, quiero registrar que pagué un gasto **en beneficio del hogar** y repartirlo **50/50** (o según ingresos), para que el reparto no dependa de quién subió el extracto.
- Como miembro, quiero **reasignar** el scope de un gasto (personal ↔ compartido) y editar el reparto, para corregir a la IA.

**H4 — Modelos**
- Como pareja, quiero elegir **modelo proporcional** y que la app calcule cuánto aporta cada uno según ingresos, para repartir con justicia.
- Como miembro, quiero ver **cuánto debo / me deben** este mes por gastos compartidos, para saldar cuentas.

**H5 — Privacidad**
- Como miembro reservado, quiero compartir **solo estadísticas** (totales por categoría, ahorro) sin transacciones individuales.
- Como hogar, queremos un modo **solo métricas globales** (salud financiera y objetivos) sin detalle individual.

**H6 — IA**
- Como usuario, quiero que la IA **detecte mi salario** y mis ingresos recurrentes, y los marque con confianza.
- Como hogar, quiero **alertas de anomalías** (subida en restaurantes, caída del ahorro, suscripciones nuevas).
- Como hogar, quiero **recomendaciones** (ajustar presupuesto, rebalancear aportaciones, riesgo en objetivos).

**H7 — Objetivos**
- Como hogar, quiero un **fondo de emergencia / vacaciones / vivienda** con **aportación recomendada por miembro** y **fecha estimada**.

**H8 — Dashboard**
- Como hogar, quiero un panel con **ingresos, gastos, ahorro, tasa de ahorro y patrimonio neto** agregados, y vistas por categoría y por persona.

---

## 3. Casos de uso

**CU-1 — Gasto compartido (el caso crítico).** Luis paga 200€ en el supermercado.
- Pagador: Luis (cuenta de Luis). Scope: `shared` (beneficiario: Hogar). Distribución: 50/50 → `ExpenseShare`(Luis 100€, Ana 100€).
- El dashboard de hogar suma 200€ en "Supermercado". El balance de Luis acumula +100€ a su favor (pagó 100 de más respecto a su cuota).

**CU-2 — Reparto proporcional.** Luis 3.000€ / Ana 2.000€ → 60/40. Mismo gasto de 200€ → shares Luis 120€, Ana 80€. El motor calcula los % desde los ingresos de los últimos N meses.

**CU-3 — Pago cruzado.** Ana paga la matrícula del hijo (300€) pero el beneficiario es el Hogar; o Luis paga un regalo para Ana (`scope=personal`, `beneficiaryUserId=Ana`). El balance lo refleja.

**CU-4 — Detección de salario.** Importa extracto; la IA marca "Nómina ACME 2.600€" como **ingreso salarial recurrente** (confianza 0.95) y lo usa para el % proporcional.

**CU-5 — Privacidad.** Ana activa "solo estadísticas": Luis ve "Ana gastó 1.200€ este mes y aporta el 40%", pero **no** sus transacciones ni comercios.

**CU-6 — Saldar cuentas.** Fin de mes: "Ana debe a Luis 140€ por gastos compartidos" → botón "Marcar como saldado" (registra `Settlement`).

**CU-7 — Objetivo familiar.** Fondo de emergencia 12.000€; aportación recomendada Luis 360€/Ana 240€/mes (proporcional); fecha estimada según ritmo actual.

---

## 4. Flujos UX

**F1 — Onboarding de hogar:** Ajustes → "Crear hogar" → nombre → invitar por email → elegir **modelo financiero** (Individual / Proporcional / Hogar) → elegir **nivel de privacidad** → listo. El invitado acepta, elige qué cuentas comparte y su visibilidad.

**F2 — Import → atribución:** Importar extracto (flujo actual) → la IA sugiere categoría **y scope** (personal/compartido) con badge de confianza → en el preview, columna "Reparto" editable por fila (hereda el modelo del hogar, override puntual) → confirmar.

**F3 — Editor de reparto (sheet):** Importe → Pagador (selector) → Scope (Personal/Compartido) → si compartido: distribución (Según modelo / 50-50 / Custom con sliders que suman 100%) → guardar.

**F4 — Selector de modelo:** Ajustes del hogar → tarjetas (Individual / Proporcional / Hogar) con explicación y preview del impacto; cambiar modelo recalcula shares futuros (no reescribe el pasado salvo confirmación).

**F5 — Privacidad:** Ajustes → 3 tarjetas (Transparente / Estadísticas / Global) + (V2) overrides por miembro y por tipo de dato.

**F6 — Dashboard familiar:** tabs "Hogar" / "Por persona" / "Categorías" / "Objetivos". Switcher de contexto (Mi vista ↔ Vista hogar) en la barra superior.

**F7 — Objetivos:** crear objetivo → tipo (emergencia/vacaciones/vivienda/jubilación/educación/custom) → meta + fecha → aportación recomendada por miembro → seguimiento.

---

## 5. Entidades y relaciones (delta sobre el esquema actual)

```prisma
model Household {
  id             String @id @default(cuid())
  name           String
  financialModel String @default("shared")      // individual | proportional | shared
  visibilityTier String @default("transparent") // transparent | shared_stats | global_only
  baseCurrency   String @default("EUR")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  members  HouseholdMember[]
}

model HouseholdMember {
  id               String @id @default(cuid())
  householdId      String
  userId           String
  role             String @default("member")  // owner | member
  status           String @default("active")  // active | invited | left
  contributionBasis String @default("income") // income | equal | custom
  customSharePct   Int?                        // basis points (custom)
  joinedAt DateTime @default(now())
  household Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([householdId, userId])
}

// Account: + householdId?, + visibility, + tipos del hogar
//   householdId? (null = puramente personal); visibility: private | household
//   type: personal | household | savings | investment | card | cash

// Expense: + atribución (el concepto crítico)
//   payerUserId       String   // quién pagó (real)
//   scope             String   // personal | shared
//   beneficiaryUserId String?  // cuando personal y beneficiario ≠ pagador
//   scopeConfidence   Float?   // 0..1 (IA)
//   scopeSource       String   // manual | ai | rule

model ExpenseShare {        // la distribución: quién se beneficia y cuánto
  id         String @id @default(cuid())
  expenseId  String
  userId     String
  amount     Int    // cents; Σ shares == expense.amount
  expense    Expense @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  @@unique([expenseId, userId])
}

model GoalContribution {    // aportación por miembro a un LifePlan
  id         String @id @default(cuid())
  lifePlanId String
  userId     String
  amount     Int    // cents
  month      String // "2026-06"
  source     String @default("manual") // manual | auto
}

// LifePlan: + householdId?  (objetivo de hogar cuando está presente)

model Settlement {          // V2 — "quién debe a quién" saldado
  id          String @id @default(cuid())
  householdId String
  fromUserId  String
  toUserId    String
  amount      Int
  period      String // "2026-06"
  status      String @default("pending") // pending | settled
  createdAt DateTime @default(now())
}
```

**Relaciones clave:** `Household 1—N HouseholdMember N—1 User`. `Account` pertenece a una persona (`ownerUserId`) y opcionalmente a un hogar (`householdId`). `Expense` tiene `payerUserId` + N `ExpenseShare` (la distribución). `LifePlan` opcionalmente `householdId` + N `GoalContribution`.

**Balance de un miembro (derivado):** `pagado_compartido(m) − Σ shares_compartidos(m)`. Positivo = le deben; negativo = debe. MVP: cálculo al vuelo; V2: `Settlement` para marcar saldado.

**Migración desde el modelo actual:**
1. Por cada `linkedUserId` (primario P + secundario S): crear `Household` (`financialModel='shared'`, `visibilityTier='transparent'`), añadir P (owner) y S (member).
2. `Account.householdId = H` para las cuentas del pool; `Account.visibility='household'`.
3. `Expense`: backfill `payerUserId = account.ownerUserId ?? userId`, `scope='shared'`, `scopeSource='manual'`; generar `ExpenseShare` (split equal por defecto; los % proporcionales se calculan al activar el modelo).
4. Usuarios sin pareja: **sin hogar** hasta que inviten (el modo individual no requiere `Household`).
5. `linkedUserId` se mantiene temporalmente para compatibilidad y se retira tras migrar las lecturas.

---

## 6. Reglas de negocio

- **RN-1 (split proporcional):** `share_pct(m) = ingreso(m) / Σ ingresos(miembros)` sobre los últimos 6 meses completos (reutiliza el patrón de Fase K). `equal` = 1/N. `custom` = `customSharePct`. Σ shares debe = importe (último céntimo al pagador para cuadrar redondeos).
- **RN-2 (scope por defecto):** nuevo gasto hereda el `financialModel` del hogar: `shared`→compartido, `individual`→personal al pagador. La IA puede sugerir lo contrario con confianza; el usuario manda.
- **RN-3 (propiedad ≠ subida):** `payerUserId`/`scope`/shares **no** dependen de quién importó el extracto; se derivan de la cuenta (owner) y del modelo, y son editables.
- **RN-4 (balances):** solo cuentan gastos `scope=shared`. Los `personal` no generan deuda entre miembros.
- **RN-5 (visibilidad):** toda lectura pasa por `visibilityFor(viewer, ownerResource, tier)`. `transparent`→todo; `shared_stats`→agregados (oculta filas y comercios); `global_only`→solo KPIs de hogar y objetivos.
- **RN-6 (cambio de modelo):** afecta a futuro; recalcular el pasado requiere confirmación explícita.
- **RN-7 (objetivos):** aportación recomendada por miembro = `(meta − actual)/meses_restantes` repartido por el modelo; fecha estimada = `actual + ritmo_aportación`.
- **RN-8 (salir del hogar):** los datos personales del miembro permanecen suyos; los gastos `shared` quedan "congelados" en el hogar con su atribución histórica.

---

## 7. Tickets técnicos — Backend

| ID | Ticket | Notas |
|---|---|---|
| BE-1 | Migración Prisma: `Household`, `HouseholdMember`, `ExpenseShare`, `GoalContribution`, `Settlement`; campos en `Account`/`Expense`/`LifePlan`. | + script de migración del §5. |
| BE-2 | Refactor de auth/scope: `req.householdId` + helper `householdScope()`; deprecar `linkedUserId` en lecturas. | Núcleo. |
| BE-3 | CRUD Hogar + membresía + invitaciones (extiende `partnerRouter`). | `POST/GET/PATCH/DELETE /api/households...` |
| BE-4 | Cuentas: propietario, `householdId`, `visibility`, tipos. | extiende `accountsRouter`. |
| BE-5 | Atribución de gasto: `payerUserId`, `scope`, `ExpenseShare`; generación de shares por modelo + override. | extiende `expensesRouter`. |
| BE-6 | Motor de contribución: % por ingresos (6m), `equal`, `custom`. | `server/lib/contributions.ts`. |
| BE-7 | Balances "quién debe a quién" + `Settlement` (V2). | `server/lib/balances.ts`. |
| BE-8 | Capa de autorización por visibilidad (`visibilityFor`) aplicada a listados y stats. | transversal, **crítico**. |
| BE-9 | IA: dimensión `scope` en el clasificador (Fase J) con confianza. | extiende `server/lib/ai/classify.ts`. |
| BE-10 | IA: detección de ingresos (salario/secundario/recurrente). | extiende recurrentes (Fase F). |
| BE-11 | Detección de anomalías (z-score por categoría, caída de ahorro, suscripciones). | job/endpoint. |
| BE-12 | Motor de recomendaciones (rebalanceo, ahorro, riesgo de objetivos). | reglas + IA opcional. |
| BE-13 | Objetivos de hogar + `GoalContribution` + aportación recomendada/proyección. | extiende `LifePlan`/`PlanDeposit`. |
| BE-14 | Endpoints de agregación del dashboard familiar (hogar/persona/categoría/objetivos). | |

## 8. Tickets técnicos — Frontend

| ID | Ticket |
|---|---|
| FE-1 | Onboarding de hogar (crear/invitar/aceptar) + selector de modelo + privacidad. |
| FE-2 | Gestión de miembros (roles, salir, % de aportación). |
| FE-3 | UI de cuentas: propietario, tipo, visibilidad. |
| FE-4 | Editor de atribución/reparto de gasto (sheet con pagador/scope/distribución + sliders). |
| FE-5 | Columna "scope + reparto" en el preview de importación (con sugerencia IA). |
| FE-6 | Ajustes de privacidad (3 niveles + overrides V2). |
| FE-7 | Dashboard familiar: Salud / Categorías / Por persona / Objetivos + switcher de contexto. |
| FE-8 | Vista de balances "quién debe a quién" + saldar. |
| FE-9 | Objetivos familiares con aportación por miembro y proyección. |
| FE-10 | Tarjetas de insights: anomalías + recomendaciones. |

## 9. APIs necesarias (resumen)

```
# Hogar y miembros
POST   /api/households                 GET /api/households/current
PATCH  /api/households/:id             (name, financialModel, visibilityTier)
POST   /api/households/invite          POST /api/households/accept
DELETE /api/households/members/:userId PATCH /api/households/members/:userId (basis, customSharePct)

# Cuentas (extiende)
PATCH  /api/accounts/:id               (ownerUserId, householdId, type, visibility)

# Gastos / atribución
POST   /api/expenses                   (+ payerUserId, scope, beneficiaryUserId, shares[])
PATCH  /api/expenses/:id/attribution   (scope, payer, shares[])
POST   /api/expenses/import/classify   (+ scope + scopeConfidence)

# Contribución y balances
GET    /api/households/contributions   (% por miembro, base)
GET    /api/households/balances?period=YYYY-MM
POST   /api/households/settlements      (V2)

# Objetivos
POST   /api/plans/:id/contributions    GET /api/plans/:id/projection

# IA / insights
GET    /api/insights/anomalies?period=…  GET /api/insights/recommendations

# Dashboard
GET    /api/dashboard/household?period=…  GET /api/dashboard/by-person?period=…
```

Convención existente: `{ data }`/`{ error }`, `requireAuth`, céntimos en BD (`toCents`/`toEuros`), batch antes de `/:id`.

---

## 10. Priorización MVP / V2 / V3

**MVP (núcleo del valor diferencial):**
- H1 Hogar + membresía + migración de `linkedUserId`.
- H2 Cuentas con propietario/visibilidad.
- H3 Atribución (pagador/scope/`ExpenseShare`) + editor + columna en import.
- H4 Modelos Individual / Proporcional / Hogar + **balances al vuelo**.
- H5 Privacidad: `transparent` y `shared_stats` (los 2 más demandados).
- H8 Dashboard familiar (Salud + Por persona + Categorías).
- H6 (parcial): scope por IA con confianza (extiende Fase J).

**V2:**
- `Settlement` (saldar cuentas) + recordatorios.
- H5 `global_only` + overrides de privacidad por miembro/tipo de dato.
- H6 detección de ingresos avanzada + **anomalías** + **recomendaciones**.
- H7 objetivos familiares con aportación por miembro y proyección.
- Multi-divisa por cuenta.

**V3:**
- Hogares >2 personas, roles avanzados (hijos con visibilidad limitada).
- Optimizador de aportaciones (50/30/20, metas con prioridades).
- Forecast de cashflow del hogar; "what-if" de objetivos.
- Liquidación con integración de pago (Bizum/transferencia).

---

## 11. Riesgos técnicos

- **Modelo de scope retroactivo:** cambiar `userId`-pool → `householdId` afecta a casi todas las queries; requiere refactor cuidadoso de `requireAuth` y backfill atómico (BE-1/BE-2). *Mitigación:* mantener `linkedUserId` en paralelo y migrar lecturas por módulo, con tests.
- **Cuadre de céntimos en splits:** redondeos que no suman el total. *Mitigación:* asignar el residuo al pagador; invariante `Σ shares == amount` testeada.
- **Autorización por visibilidad:** fácil filtrar de más o de menos (fuga de datos). *Mitigación:* capa central `visibilityFor` + tests por nivel; nunca filtrar en el cliente.
- **Coste/latencia IA del scope:** clasificar scope por transacción. *Mitigación:* reutilizar batch por comercio de Fase J; el scope suele ser estable por comercio → cae en reglas aprendidas.
- **Recálculo de % proporcional:** ingresos variables mes a mes. *Mitigación:* mediana de 6 meses (consistente con Fase K), congelar % al cierre de mes.
- **Integridad al salir del hogar:** evitar huérfanos. *Mitigación:* RN-8 (congelar histórico, no borrar).

## 12. Riesgos de experiencia de usuario

- **Sobrecarga de configuración:** demasiadas opciones (modelo × privacidad × por cuenta) abruman. *Mitigación:* onboarding guiado con un preset recomendado (Proporcional + Estadísticas) y "avanzado" plegado.
- **Confusión pagador/beneficiario/reparto:** concepto potente pero abstracto. *Mitigación:* lenguaje natural ("Pagó Luis · Lo disfruta el Hogar · 60/40"), no jerga; defaults por modelo.
- **Fricción del reparto en cada gasto:** insostenible a mano. *Mitigación:* scope por defecto del modelo + aprendizaje por comercio; reparto manual solo como excepción.
- **Tensión de privacidad:** un miembro siente vigilancia, otro opacidad. *Mitigación:* niveles claros, simétricos por defecto, y transparencia sobre "qué ve tu pareja".
- **Balances mal entendidos como "deuda":** puede generar conflicto. *Mitigación:* framing colaborativo ("para igualar este mes"), no acusatorio.

## 13. Oportunidades de diferenciación

- **Modelo agnóstico a las cuentas bancarias:** la mayoría de apps asumen cuenta conjunta o son 100% individuales. Soportar **proporcional por ingresos** sin cuenta común es un diferenciador fuerte para parejas reales.
- **Separación pagador / beneficiario / distribución:** modela la realidad (uno paga, ambos disfrutan) mejor que un simple "gasto compartido".
- **Privacidad por niveles:** permite parejas con distinto grado de apertura financiera — terreno casi inexistente en el mercado.
- **IA que clasifica *scope*, no solo categoría:** "esto es tuyo / familiar / compartido" con confianza y aprendizaje.
- **Rebalanceo justo automático + objetivos familiares con aportación por persona:** convierte la app de "registro" a "copiloto financiero del hogar".
- **Onboarding sin fricción** apalancado en la importación + IA ya construidas (Fases G/I/J/K): el hogar arranca con datos reales en minutos.

---

## Decisiones cerradas

1. **Modelo de transacción:** se mantienen `Expense`/`Income` **separadas** (no `Transaction` unificada). La atribución (pagador/beneficiario/split) se añade a `Expense`. ✅
2. **Privacidad por defecto:** `shared_stats` — totales por categoría, ingresos agregados, ahorro y objetivos visibles; transacciones individuales ocultas. ✅
3. **Balances:** en MVP solo **informativos** (cálculo al vuelo, RN-4). `Settlement` (marcar saldado) → **V2**. ✅
