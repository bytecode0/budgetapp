# LifePlan: visión, cliente y plan hasta los primeros 1.000 usuarios

Borrador del 4 nov 2026, escrito con Luis. Es un documento vivo: las decisiones se anotan con su fecha.

---

## 1. Propósito

**Dar a familias que ganan bien una metodología sencilla para dejar de llegar justas a fin de mes y ahorrar de forma constante, para que luego inviertan en lo que ellas quieran y construyan riqueza poco a poco.**

LifePlan no es otra app para apuntar gastos. Es un **sistema**:
1. **Ver**: a dónde va el dinero y cuánto del sueldo está ya comprometido antes de cobrarlo (cuotas, tarjetas, préstamos).
2. **Ordenar**: un presupuesto mensual donde cada euro tiene un destino.
3. **Salir de deudas**: un plan con fecha (bola de nieve o avalancha).
4. **Ahorrar con propósito**: planes con nombre y meta (fondo de emergencia, entrada de una casa, estudios de los hijos).
5. **Ahorrar para invertir**: apartar cada mes una parte para invertir. **LifePlan no dice en qué invertir** (decisión del 4 nov): da el método para que el dinero exista; cada uno lo invierte donde quiera.

LifePlan no da asesoramiento de inversión: ni recomienda productos ni gestiona dinero. Conviene decirlo en la app y en el taller (en España el asesoramiento financiero es una actividad regulada).

## 2. Cliente objetivo (decisión del 4 nov)

**No es** la persona sobreendeudada que no llega a fin de mes por falta de ingresos.

**Es** la persona o la familia que:
- **gana bien** (ingresos estables, a menudo dos sueldos en el hogar);
- **llega a fin de mes, pero justa**, y no entiende cómo con lo que gana;
- **puede tener deudas** (tarjeta, coche, compras a plazos), pero no la ahogan;
- **no ahorra de forma constante** y no invierte, o lo hace sin método;
- **nunca aprendió un sistema**: no le falta dinero, le falta método.

**Lo que piensa:** "Con lo que ganamos deberíamos estar mejor." "Cada mes desaparece el dinero y no sé en qué." "Quiero empezar a ahorrar e invertir, pero no sé por dónde empezar."

**Lo que quiere conseguir:** tranquilidad, un colchón para imprevistos, salir de las cuotas y saber que su dinero trabaja para su familia.

**Primer grupo (BETA):** personas de la iglesia de Luis. Es un grupo de confianza, que ya se reúne y en el que la buena administración del dinero (la mayordomía) es un valor compartido.

### Qué cambia respecto a lo anterior
Hasta ahora el producto se describía como "para personas que salen del sobreendeudamiento" (CLAUDE.md y la memoria del pivot). La deuda sigue siendo una parte del sistema, pero **el eje pasa a ser el ahorro y la creación de riqueza**. El "futuro comprometido" se mantiene como el diagnóstico de entrada ("mira cuánto de tu sueldo ya tiene dueño"), no como el objetivo final.

**Hecho (4 nov):** la sección "What this is" del CLAUDE.md describe ya este cliente.

**La app no enseña (decisión del 4 nov).** Enseña la empresa, en los talleres y en las redes sociales; la app es la herramienta donde se aplica. No se añaden lecciones ni contenidos dentro de la app.

## 3. Etapas

| Etapa | Cuándo | Meta | Quién |
|---|---|---|---|
| **0. Preparación** | hasta mediados de nov 2026 | La app lista para gente que no es Luis | Luis + Claude |
| **1. BETA** | nov – dic 2026 | ~20 usuarios de la iglesia que la usan de verdad | Grupo fundador |
| **2. Grupos** | ene – mar 2027 | 150–250 usuarios activos | Grupos guiados por los fundadores |
| **3. Comunidad** | abr – dic 2027 | 1.000 usuarios activos | Otras iglesias, contenido, recomendaciones |

Las cifras de las etapas 2 y 3 son objetivos de trabajo, no previsiones: se ajustan con lo que enseñe la BETA.

### Qué es un "usuario activo"
**Una persona que ha registrado o revisado movimientos en la app en los últimos 30 días.** Un registro sin uso no cuenta. Hoy la app **no mide esto**; hace falta un ticket pequeño para contarlo desde la base de datos, sin herramientas de terceros que vean datos financieros.

## 4. Etapa 0: preparación (hasta mediados de noviembre)
- Desplegar lo pendiente (arreglo de duplicados) y probar el flujo completo con una cuenta nueva, desde cero, en el móvil.
- Medir usuarios activos (ticket por crear).
- Un canal de soporte y opiniones: un grupo de WhatsApp de la BETA y el email `contact@luisvespa.com`.
- Una **guía de inicio** de una página: crear la cuenta, el primer presupuesto, apuntar gastos o importar el extracto, y crear el primer plan de ahorro.
- Una **promesa de privacidad clara**, en lenguaje sencillo: quién puede ver los datos (nadie de la iglesia; los datos del hogar solo la pareja), qué no se vende ni se comparte y cómo borrar la cuenta. En una comunidad donde todos se conocen, esta es la primera duda.

## 5. Etapa 1: BETA en la iglesia (nov – dic 2026)

**Cambio del 4 nov:** todavía no hay taller. Para empezar, Luis invita **uno a uno a amigos** que ve que necesitan la app. El taller queda como opción para más adelante. Consecuencia: la app tiene que entenderse sola, sin acompañamiento presencial, y los amigos entran por olas, sin una fecha de arranque. El orden de los tickets está en `tickets.md`.

**Objetivo:** no es crecer, es **aprender y retener**. Que unas 20 personas (de las más de 100 de la iglesia; ~10–12 hogares) usen la app durante 8 semanas y que la mayoría siga usándola al final.

**Cómo:**
1. **Invitación personal**, no masiva: Luis elige a unas 20 personas (~10–12 hogares) que encajan con el cliente objetivo (sección 2). Que se sientan **grupo fundador**: entran primero, opinan y tienen Premium gratis para siempre.
2. **Taller de arranque presencial** (1 sesión de ~90 min, en el espacio de la iglesia que Luis ya tiene disponible): por qué llegamos justos aunque ganemos bien, el sistema de 5 pasos, y crear juntos la cuenta y el primer presupuesto en el móvil, allí mismo. La mayoría de las apps se abandonan en el primer día; hacerlo juntos evita eso.
3. **Acompañamiento:** un mensaje por semana en el grupo con una tarea pequeña ("esta semana: revisa tus suscripciones", "crea tu fondo de emergencia"). Al final del primer mes, una segunda sesión: qué ha aprendido cada uno y qué falla en la app.
4. **Escuchar:** cada opinión se convierte en un ticket en `docs/tickets.md` si merece la pena.

**Medir al final de la BETA:**
- Usuarios activos a las 4 y a las 8 semanas (meta: al menos el 60 % de los que empezaron).
- Cuántos crearon un plan de ahorro y cuántos hicieron al menos una aportación.
- 3–5 **testimonios** con permiso ("en dos meses ahorramos X por primera vez").
- Qué hogares estarían dispuestos a **guiar un grupo** en la etapa 2.

## 6. Etapa 2: grupos guiados (ene – mar 2027)
El modelo que mejor funciona para enseñar finanzas en comunidades de fe son los **grupos pequeños con un curso**: un facilitador, 8–12 personas, unas semanas de sesiones. LifePlan es la herramienta del curso.

- **Kit del curso** (Luis escribe, Claude ayuda): 4–6 sesiones con guion, presentación, tarea semanal y el paso de la app que toca en cada una.
- **Mensaje mixto** (decisión del 4 nov): el contenido base es neutro, para poder llevarlo fuera de la iglesia, y cada sesión valida sus principios con la Biblia en un apartado propio (versión iglesia). Mismo método, dos maneras de presentarlo.
- Los hogares fundadores que quieran se convierten en **facilitadores**: 10–20 grupos de ~10 personas son 100–200 usuarios nuevos acompañados.
- **Invitar a la pareja** ya está en la app y es gratis: cada hogar trae a dos personas.
- Primera expansión a **otras iglesias** cercanas a través de los pastores o líderes que conozca Luis, con el taller como puerta de entrada.

## 7. Etapa 3: comunidad (abr – dic 2027), hasta 1.000 activos
Todo sin anuncios:
- **Red de iglesias:** el kit del curso se ofrece gratis a otras congregaciones. Cada iglesia que lo adopta trae grupos enteros.
- **Recomendación:** un enlace de invitación para traer amigos (LPBETA-08, después de la BETA). Quien invite a 5 personas que se vuelvan activas obtiene un descuento para comprar Premium.
- **Contenido propio de Luis:** historias y consejos cortos (Instagram, YouTube, un boletín por email) basados en lo que pasa en los grupos, con permiso. Los testimonios convencen más que cualquier anuncio.
- **Charlas y talleres** abiertos (asociaciones, empresas de conocidos, colegios de los hijos) con el mismo formato del taller de arranque.

**Cuenta aproximada:** para llegar a 1.000 activos hacen falta unos 2.000 registros si se retiene a la mitad. Con grupos de 10, son unos 200 grupos a lo largo del año, o lo que sumen las iglesias, las recomendaciones y el contenido. El dato que más importa es la retención de la BETA: si es alta, el boca a boca hace el resto.

## 8. Premium en este plan
- Durante la BETA y en `budget.luisvespa.com` (preproducción), **todo es gratis** y la familia y los amigos tienen Premium gratis para siempre.
- Precios decididos (ticket LPBETA-03): **Premium 24 €/año, Hogar 36 €/año**, solo anual, con precio de fundador. La versión gratis es completa; Premium es comodidad (banca e importación con IA).
- Cobrar de verdad será en un entorno de producción futuro, no antes de la etapa 2.

## 9. Implicaciones para el producto (por convertir en tickets cuando Luis decida)
- **Medir usuarios activos** (necesario para este plan).
- **Ahorro e inversión como protagonistas:** hoy los planes de ahorro existen (Planes y aportaciones), pero el Inicio gira alrededor del presupuesto y la deuda. Revisar qué ve primero un usuario del nuevo cliente objetivo.
- **El paso "ahorrar para invertir"**: no hay función de inversión (decisión del 4 nov). Como mucho, un plan de ahorro tipo "para invertir" y un aviso de que LifePlan no asesora sobre inversiones.
- **Enlace de invitación** para amigos.
- Actualizar textos del onboarding y de la web que hablen solo de sobreendeudamiento.

## 10. Preguntas respondidas (4 nov)
1. **Iglesia:** más de 100 personas; unas **20** encajan con el cliente objetivo → tamaño de la BETA.
2. **Taller:** lo da Luis en persona; hay un espacio disponible en la iglesia.
3. **Mensaje:** mixto o neutro, siempre validando los principios bíblicos (sección 6).
4. **Invertir:** LifePlan solo da la metodología para ahorrar; cada uno invierte en lo que quiera (sección 1).
