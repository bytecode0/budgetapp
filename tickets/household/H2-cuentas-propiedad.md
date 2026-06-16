# [H2] Propiedad y tipos de cuenta

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **MVP**
**Esfuerzo:** S–M · **Riesgo:** Bajo
**Depende de:** H1 · **Habilita:** H3, H8

## Contexto
Las cuentas ya tienen `ownerUserId`. Falta asociarlas a un hogar, declarar su visibilidad y alinear los tipos con el modelo de producto (personal/hogar/ahorro/inversión). La cuenta bancaria es solo una fuente de datos: no se asume cuenta conjunta.

## Alcance (MVP)
- **Modelo** (`Account`): `+ householdId?` (null = puramente personal), `+ visibility` ('private' | 'household'); ampliar `type` a `personal | household | savings | investment | card | cash`.
- **API**: `PATCH /api/accounts/:id` acepta `householdId`, `visibility`, `type`, `ownerUserId`.
- **UX**: en el alta/edición de cuenta, selector de propietario (miembros del hogar), tipo y visibilidad.
- **Onboarding**: al unirse a un hogar, elegir qué cuentas se comparten (visibility = household).

## Archivos afectados
- `prisma/schema.prisma` (+ migración), `server/routes/accounts.ts`
- `src/app/components/` (gestión de cuentas), hook `useAccounts`

## Criterios de aceptación
- [ ] Una cuenta puede ser personal (private) o de hogar (household), con propietario explícito.
- [ ] Las cuentas `private` no son visibles para el resto del hogar (respetando H5).
- [ ] Migración: cuentas del pool actual → `householdId` del hogar migrado, `visibility='household'`.

## Fuera de alcance
- Multi-divisa por cuenta → V2.
- Conexión bancaria automática (open banking, Fase H) → independiente.
