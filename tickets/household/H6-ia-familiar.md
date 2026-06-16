# [H6] IA familiar (scope, ingresos, anomalías, recomendaciones)

**Épica padre:** [Finanzas para parejas y hogares](./README.md) · **MVP** (parcial) + **V2**
**Esfuerzo:** L · **Riesgo:** Medio (coste/latencia IA, falsos positivos)
**Depende de:** H3, H4 · Reutiliza Fases F (recurrentes) y J (clasificador)

## Contexto
Extiende la IA existente al contexto de hogar. La IA es *opt-in* y degrada sin `ANTHROPIC_API_KEY`.

## Alcance

### MVP
- **Clasificación de scope**: añadir la dimensión `personal | familiar | compartido` con **nivel de confianza** al clasificador de la Fase J (`server/lib/ai/classify.ts`). El scope suele ser estable por comercio → se materializa como regla aprendida (barato).

### V2
- **Detección de ingresos**: salario principal, salarios secundarios, recurrentes (extiende detección de recurrentes de Fase F); alimenta el % proporcional de H4.
- **Detección de anomalías** (`server/lib/insights/anomalies.ts`): z-score por categoría mes a mes, caída del ahorro, incremento de suscripciones, variaciones por categoría. Endpoint `GET /api/insights/anomalies?period=…`.
- **Recomendaciones** (`server/lib/insights/recommendations.ts`): ajustar presupuesto, incrementar ahorro, rebalancear aportaciones, alertar desviación de objetivos. Endpoint `GET /api/insights/recommendations`. Reglas deterministas + IA opcional para el texto.

## Archivos afectados
- `server/lib/ai/classify.ts` (scope), `server/lib/insights/*` (nuevos), rutas de insights
- `src/app/components/` (tarjetas de insights: anomalías + recomendaciones)

## Criterios de aceptación
- [ ] (MVP) La IA sugiere scope con confianza; editable; aprendido por comercio.
- [ ] (V2) Anomalías detectadas con explicación (p. ej. "+40% en restaurantes vs media").
- [ ] (V2) Recomendaciones accionables ligadas a presupuesto/ahorro/objetivos.
- [ ] Degrada sin API key (funciones IA ocultas; el resto opera).

## Fuera de alcance
- Reentrenamiento/fine-tuning de modelos propios.
