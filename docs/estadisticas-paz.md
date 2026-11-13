# Medir la paz (LPBETA-24): las estadísticas para Luis

La pregunta *"¿Cómo te sientes hoy con tu dinero?"* se responde una vez por periodo de presupuesto con una cara, guardada como 1 (muy intranquilo) a 5 (en paz), en la tabla `PeaceCheckin`. Cada respuesta es **privada**: solo la ve quien la da, tampoco su pareja.

Luis solo ve **agregados de grupos de 5 o más**. Con menos, una media identifica a alguien entre amigos que se conocen, así que no se muestra nada (ni siquiera cuántos respondieron). Nunca respuestas individuales, ids ni periodos.

## Con el script

```bash
DATABASE_URL='' npm run stats:active   # la URL de Neon entre las comillas
```

Al final del informe de usuarios activos salen las dos líneas de la paz (`server/lib/peace.ts`).

## Con el SQL Editor de Neon

Las dos consultas dan lo mismo que el script. Son de solo lectura.

**Último periodo.** Como cada hogar tiene su día de cobro, no hay una sola etiqueta de periodo: se toma la última respuesta de cada persona, si la dio en los últimos 31 días.

```sql
WITH latest AS (
  SELECT DISTINCT ON ("userId") score, "createdAt"
  FROM "PeaceCheckin"
  WHERE score BETWEEN 1 AND 5
  ORDER BY "userId", period DESC
), recent AS (
  SELECT score FROM latest WHERE "createdAt" >= now() - interval '31 days'
)
SELECT
  CASE WHEN count(*) >= 5 THEN count(*)::text ELSE 'menos de 5' END AS respondieron,
  CASE WHEN count(*) >= 5 THEN round(avg(score), 1)::text END AS media,
  CASE WHEN count(*) >= 5 THEN concat_ws(' / ',
    count(*) FILTER (WHERE score = 1), count(*) FILTER (WHERE score = 2), count(*) FILTER (WHERE score = 3),
    count(*) FILTER (WHERE score = 4), count(*) FILTER (WHERE score = 5)) END AS "distribución 1–5"
FROM recent;
```

**Evolución.** De quienes tienen 2 o más respuestas: la primera (la línea base) frente a la última.

```sql
WITH per_person AS (
  SELECT
    (array_agg(score ORDER BY period ASC))[1]  AS primera,
    (array_agg(score ORDER BY period DESC))[1] AS ultima
  FROM "PeaceCheckin"
  WHERE score BETWEEN 1 AND 5
  GROUP BY "userId"
  HAVING count(*) >= 2
)
SELECT
  CASE WHEN count(*) >= 5 THEN count(*)::text ELSE 'menos de 5' END AS personas,
  CASE WHEN count(*) >= 5 THEN count(*) FILTER (WHERE ultima > primera) END AS suben,
  CASE WHEN count(*) >= 5 THEN count(*) FILTER (WHERE ultima = primera) END AS igual,
  CASE WHEN count(*) >= 5 THEN count(*) FILTER (WHERE ultima < primera) END AS bajan
FROM per_person;
```

No escribas otras consultas sobre `PeaceCheckin` que devuelvan filas sueltas: la promesa de privacidad (`legal.promise`) dice que Luis solo ve medias de grupos de 5 o más.
