# [H1] Hogar y Membresía

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **MVP**
**Esfuerzo:** M–L · **Riesgo:** Medio (refactor de scope + migración)
**Depende de:** — · **Habilita:** H2–H8 (cimiento)

## Contexto
Sustituye el hack actual "fusionar en el pool del primario" (`UserSettings.linkedUserId`) por una entidad `Household` de primera clase con membresía, manteniendo la propiedad del dato por persona. Es el cimiento del resto de la épica.

## Alcance (MVP)
- **Modelos** (`prisma`): `Household { name, financialModel, visibilityTier, baseCurrency }`, `HouseholdMember { householdId, userId, role, status, contributionBasis, customSharePct }`.
- **Migración**: por cada `linkedUserId`, crear `Household` (`financialModel='shared'`, `visibilityTier='transparent'`), añadir primario (owner) y secundario (member); usuarios sin pareja → sin hogar.
- **Auth/scope** (`requireAuth`): exponer `req.householdId` + helper `householdScope()`; mantener `linkedUserId` en paralelo y migrar lecturas por módulo.
- **API**: `POST /api/households`, `GET /api/households/current`, `PATCH /api/households/:id` (name, financialModel, visibilityTier), `POST /invite`, `POST /accept`, `DELETE/PATCH /members/:userId`. Extiende `partnerRouter`.
- **Reglas**: RN-8 (salir del hogar congela histórico compartido, no borra).

## Archivos afectados
- `prisma/schema.prisma` (+ migración + script de backfill)
- `server/middleware/auth.ts`, `server/routes/partner.ts` → `households.ts`
- lecturas por módulo (incremental)

## Criterios de aceptación
- [ ] Crear hogar e invitar/aceptar funciona; ambos miembros comparten scope.
- [ ] Migración: parejas existentes quedan como hogar `shared/transparent` sin pérdida de datos.
- [ ] Usuario sin pareja opera sin `Household` (modo individual).
- [ ] Salir del hogar conserva los datos personales del miembro.

## Fuera de alcance
- Hogares >2 personas y roles avanzados → V3.
- Eliminar `linkedUserId` (se retira cuando todas las lecturas migren).
