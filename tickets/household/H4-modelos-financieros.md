# [H4] Modelos financieros + contribución + balances

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **MVP**
**Esfuerzo:** M · **Riesgo:** Medio
**Depende de:** H3 · **Habilita:** H7, H8

## Contexto
Soportar tres modelos de gestión sin asumir cuenta conjunta: **Individual**, **Compartido Proporcional** (por % de ingresos), **Hogar** (visión agregada). El motor de contribución calcula los % y deriva los balances "quién debe a quién".

## Alcance (MVP)
- **Motor de contribución** (`server/lib/contributions.ts`):
  - `proportional`: `share_pct(m) = ingreso(m) / Σ ingresos`, mediana de 6 meses (reutiliza patrón Fase K).
  - `equal`: 1/N. `custom`: `HouseholdMember.customSharePct`.
- **Balances** (`server/lib/balances.ts`, al vuelo): `balance(m) = pagado_compartido(m) − Σ shares_compartidos(m)`. Positivo = le deben.
- **API**: `GET /api/households/contributions` (% por miembro + base), `GET /api/households/balances?period=YYYY-MM`.
- **UX**: selector de modelo (3 tarjetas con explicación + preview de impacto); vista de balances "quién debe a quién" (informativa).
- **Regla** RN-6: cambiar modelo afecta a futuro; recalcular el pasado requiere confirmación.

## Archivos afectados
- `server/lib/contributions.ts`, `server/lib/balances.ts` (nuevos), `server/routes/households.ts`
- `src/app/components/` (selector de modelo, panel de balances)

## Criterios de aceptación
- [ ] Proporcional: con Luis 3.000€/Ana 2.000€, los shares de un gasto compartido salen 60/40.
- [ ] Balances correctos: solo cuentan gastos `scope=shared`; cuadran al céntimo.
- [ ] Cambiar de modelo no reescribe el pasado salvo confirmación.

## Fuera de alcance
- `Settlement` (marcar saldado) → **V2** (en MVP los balances son solo informativos).
- Optimizador de aportaciones (50/30/20) → V3.
