# [Fase G] Importación de extractos bancarios (XLSX/CSV) — BBVA primer formato

**Tipo:** Epic / Feature (nueva — habilita la importación que A/E/F dejaron preparada)
**Esfuerzo:** M–L · **Riesgo:** Medio
**Depende de (duro):** Fase A (`source`, `externalId`) — ✅ ya implementada
**Recomendado antes:** Fase E (cuentas), Fase B (auto-categorización), Fase F (dedupe) — ver sección "Orden recomendado"
**Habilita:** Fase H — Open banking / agregador (épico futuro, no incluido aquí)

## Contexto
Hoy los gastos solo se introducen a mano (`AddExpense.tsx` → `POST /api/expenses`). La Fase A dejó los cimientos para importar: `Expense.source` (`manual|import`), `Expense.externalId?` y `@@unique([userId, externalId])` para idempotencia, más `normalizeMerchant()` para el comercio. Falta el importador en sí.

BBVA permite descargar el extracto en **`.xlsx`** (no CSV), por lo que el parser necesita una librería de Excel, no un split de texto. Al ser un único banco y formato conocido, el MVP es acotable.

## Decisiones de diseño
- **Librería de lectura:** SheetJS (`xlsx`) o `exceljs` (decidir; SheetJS es más ligero para solo-lectura).
- **`externalId` derivado:** los export de BBVA **no traen un ID de transacción estable**. Generar una clave de idempotencia determinista = hash de `fecha + importe + concepto (+ saldo si está)`. Reimportar el mismo fichero no debe duplicar (lo garantiza `@@unique([userId, externalId])`).
- **Importe → céntimos:** las filas vienen en euros; convertir con `toCents()` (`server/lib/money.ts`) al insertar, igual que el resto del backend.
- **Comercio:** poblar `merchant` con `normalizeMerchant(concepto)` para reutilizar reglas de categorización (Fase B) y detección de recurrentes (Fase F).
- **Cuenta:** si Fase E está hecha, el import se asocia a una `Account`; si no, queda sin `accountId` (o cuenta "por defecto") — ver dependencias.

## Alcance
- Subida de fichero (`.xlsx`, y `.csv` como extra barato) desde un nuevo flujo en `Activity.tsx` (o módulo de importación).
- `server/lib/parsers/bbva.ts`: mapeo de columnas BBVA (fecha, concepto, importe, saldo) → filas normalizadas.
- `server/lib/importStatement.ts`: normalización (`merchant`, `toCents`), cálculo de `externalId`, detección de filas ya existentes.
- `POST /api/expenses/import/preview` — parsea y devuelve filas con flag `new|duplicate` (sin escribir).
- `POST /api/expenses/import/confirm` — inserta las filas confirmadas con `source='import'`.
- Pantalla de **previsualización/confirmación** antes de insertar (qué se importa, qué se omite por duplicado, categoría sugerida).
- `src/app/hooks/useImport.ts` (nuevo).
- Strings en `en.json` / `es.json`.

## Archivos afectados
- `server/routes/expenses.ts` (sub-rutas `import/preview`, `import/confirm` — antes de `/:id`)
- `server/lib/parsers/bbva.ts`, `server/lib/importStatement.ts` (nuevos)
- `server/lib/normalizeMerchant.ts`, `server/lib/money.ts` (reutilizados)
- `package.json` (dependencia de lectura xlsx)
- `src/app/components/Activity.tsx` (entrada al flujo), nuevo componente de importación
- `src/app/hooks/useImport.ts` (nuevo)
- `src/locales/en.json`, `src/locales/es.json`

## Criterios de aceptación
- [ ] Subir un `.xlsx` real de BBVA produce una previsualización con fecha/concepto/importe correctos.
- [ ] Los importes se guardan en céntimos (`toCents`) y la API los devuelve en euros (regla del borde de la Fase A/céntimos).
- [ ] Reimportar el mismo fichero **no crea duplicados** (idempotencia por `externalId`).
- [ ] Las filas importadas quedan con `source='import'` y `merchant` normalizado.
- [ ] Si Fase B está hecha: las filas llegan con categoría sugerida por reglas.
- [ ] Si Fase E está hecha: las filas se asocian a la cuenta seleccionada.
- [ ] Strings en `en.json` y `es.json`.

## Fuera de alcance
- **Open banking / agregador** (Tink, GoCardless, Plaid…), OAuth, consentimientos y sincronización periódica → **Fase H** (épico independiente).
- Parsers de otros bancos (se añaden incrementalmente sobre la misma arquitectura `parsers/<banco>.ts`).
- Multi-divisa (decisión pendiente #6).
