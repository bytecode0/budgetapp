# [H5] Privacidad y visibilidad

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **MVP** (parcial)
**Esfuerzo:** M · **Riesgo:** Alto (fuga de datos si se filtra mal)
**Depende de:** H1 · **Habilita:** H8

## Contexto
Tres niveles de visibilidad para soportar parejas con distinto grado de apertura. Decisión cerrada: por defecto `shared_stats`.

| Nivel | Ven |
|---|---|
| `transparent` | Transacciones, comercios, categorías, ingresos. |
| `shared_stats` | Totales por categoría, ingresos agregados, ahorro, objetivos. **No** transacciones individuales. |
| `global_only` | Solo KPIs del hogar y progreso de objetivos. Sin detalle individual. |

## Alcance
- **MVP**: niveles `transparent` y `shared_stats` (los más demandados).
- **Capa de autorización** (`server/lib/visibility.ts`): `visibilityFor(viewer, ownerResource, tier)` aplicada en **todos** los listados y endpoints de stats. **Nunca** filtrar en cliente.
- **API**: el `visibilityTier` vive en `Household` (PATCH en H1); cada endpoint de lectura respeta el filtro.
- **UX**: ajustes con 3 tarjetas; mensaje claro de "qué ve tu pareja".
- **V2**: `global_only` + overrides por miembro y por tipo de dato (arquitectura preparada para ampliar).

## Reglas
- RN-5 (toda lectura pasa por `visibilityFor`).

## Archivos afectados
- `server/lib/visibility.ts` (nuevo), aplicado en `expenses`/`income`/`analytics`/`dashboard` routes
- `src/app/components/` (ajustes de privacidad)

## Criterios de aceptación
- [ ] En `shared_stats`, un miembro ve totales por categoría e ingresos agregados pero NO transacciones/comercios del otro.
- [ ] El filtrado es server-side y testeado por nivel (sin fugas).
- [ ] Cambiar de nivel actualiza inmediatamente lo que ve la pareja.

## Fuera de alcance (V2)
- `global_only` y overrides granulares por miembro/tipo de dato.
