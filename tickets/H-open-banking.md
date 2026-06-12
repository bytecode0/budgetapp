# [Fase H] Open banking — sincronización vía agregador

**Tipo:** Epic / Feature (placeholder — alcance esbozado, no listo para implementar)
**Esfuerzo:** L (probablemente varios tickets) · **Riesgo:** Alto
**Depende de (duro):** Fase G (importación de extractos) y Fase E (cuentas)
**Estado:** pendiente de decisiones de producto/proveedor antes de detallarse

## Contexto
La Fase G cubre la importación manual de extractos (`.xlsx`/`.csv`). H da el siguiente paso: **conectar la cuenta bancaria del usuario a un agregador open banking** para sincronizar transacciones automáticamente, sin subir ficheros. Esto reutiliza casi toda la maquinaria de G (normalización, `toCents`, `externalId`, dedupe, asignación a `Account`) pero añade integración con un tercero, OAuth/consentimientos y sincronización periódica — por eso es un épico aparte y de mayor riesgo (regulatorio y operacional).

## Decisiones previas (bloquean el detalle de este ticket)
- **Proveedor/agregador:** GoCardless Bank Account Data (ex-Nordigen), Tink, Plaid, TrueLayer… Criterios: cobertura de bancos ES (BBVA), modelo de precios, calidad de categorización propia, requisitos PSD2.
- **Modelo de coste:** muchos agregadores cobran por conexión/consentimiento activo → impacta el plan de precios (free vs premium en `Subscription`).
- **Alcance del consentimiento:** solo lectura de transacciones (AIS). Sin iniciación de pagos.
- **Frecuencia de sync:** manual ("refrescar ahora") vs job programado diario.
- **Caducidad de consentimiento:** PSD2 obliga a renovar (típicamente 90 días) → flujo de reconsentimiento.

## Alcance esbozado (a refinar tras elegir proveedor)
- Entidad nueva `BankConnection { userId, provider, providerItemId, accountRef, status, consentExpiresAt, lastSyncedAt }` enlazada a `Account` (Fase E).
- Almacenamiento **seguro** de tokens/credenciales del proveedor (cifrado en reposo, fuera de logs).
- Flujo de conexión (redirect OAuth / link del agregador) + callback de consentimiento.
- `server/lib/providers/<agregador>.ts`: cliente del agregador (listar cuentas, traer transacciones).
- Job/endpoint de sincronización que reutiliza `importStatement.ts` de la Fase G (normalización, `externalId`, dedupe) — aquí el agregador **sí suele dar un id estable** de transacción, que se usa directamente como `externalId`.
- UI: conectar/desconectar banco, estado de la conexión, reconsentimiento, "última sincronización".
- Manejo de errores y reintentos (banco caído, consentimiento expirado, rate limits).

## Criterios de aceptación (provisionales)
- [ ] El usuario conecta una cuenta BBVA vía el agregador y ve sus transacciones sincronizadas.
- [ ] La sincronización no duplica transacciones ya importadas (idempotencia por `externalId` del proveedor).
- [ ] Las transacciones llegan asociadas a su `Account` y con `source='import'` (o un `source` específico del proveedor).
- [ ] Tokens/credenciales almacenados cifrados y nunca expuestos en respuestas ni logs.
- [ ] Flujo de reconsentimiento cuando el consentimiento PSD2 caduca.

## Fuera de alcance
- Iniciación de pagos (PIS) — solo lectura de datos (AIS).
- Bancos fuera del agregador elegido.
- Categorización avanzada propia del agregador (se evalúa aparte; por defecto se usan las reglas de la Fase B).

> ⚠️ Este ticket es un **placeholder**: no debe entrar en sprint hasta cerrar la decisión de proveedor y el impacto en precios/`Subscription`.
