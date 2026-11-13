# Medir la paz (LPBETA-24): las estadísticas para Luis

La pregunta *"¿Cómo te sientes hoy con tu dinero?"* se responde una vez por periodo de presupuesto con una cara, guardada como 1 (muy intranquilo) a 5 (en paz), en la tabla `PeaceCheckin`. Cada respuesta es **privada**: solo la ve quien la da, tampoco su pareja.

Lo que Luis ve, y nada más (es lo que dice la promesa de privacidad, `legal.promise`):

- **Solo meses cerrados** (mes natural en UTC, según cuándo se respondió): el último mes terminado y los dos anteriores. Nunca una ventana que llegue hasta hoy: dos consultas con un día de diferencia revelarían una respuesta nueva.
- Por mes, cada persona cuenta una vez (su última respuesta de ese mes). **Solo si respondieron 5 personas o más:** la media con un decimal y cuántas personas en una **franja** ("5–9", "10–19", "20–49", "50+"), nunca el número exacto. Con menos: "menos de 5".
- La **distribución 1–5** solo si cada cara elegida por alguien la eligieron 5 personas o más; si no, no se muestra.
- La **evolución** (primera respuesta frente a la última, por fecha, de quienes tienen 2 o más antes de este mes): solo si suben, igual y bajan tienen **cada uno** 5 personas o más; si no, "sin datos suficientes".

## Con el script

```bash
DATABASE_URL='' npm run stats:active   # la URL de Neon entre las comillas
```

Al final del informe de usuarios activos salen las líneas de la paz (`server/lib/peace.ts`). Si la tabla aún no existe en esa base, el informe lo dice y sigue.

## Con el SQL Editor de Neon

Las dos consultas dan lo mismo que el script. Son de solo lectura.

**Por mes cerrado:**

```sql
WITH bounds AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AS this_month
), months AS (
  SELECT generate_series(this_month - interval '3 months', this_month - interval '1 month', interval '1 month') AS m
  FROM bounds
), latest AS (
  SELECT DISTINCT ON ("userId", date_trunc('month', "createdAt")) date_trunc('month', "createdAt") AS m, score
  FROM "PeaceCheckin", bounds
  WHERE score BETWEEN 1 AND 5 AND "createdAt" < this_month
  ORDER BY "userId", date_trunc('month', "createdAt"), "createdAt" DESC
), agg AS (
  SELECT months.m, count(latest.score) AS n, avg(latest.score) AS media,
    count(*) FILTER (WHERE score = 1) AS c1, count(*) FILTER (WHERE score = 2) AS c2, count(*) FILTER (WHERE score = 3) AS c3,
    count(*) FILTER (WHERE score = 4) AS c4, count(*) FILTER (WHERE score = 5) AS c5
  FROM months LEFT JOIN latest ON latest.m = months.m
  GROUP BY months.m
)
SELECT
  to_char(m, 'YYYY-MM') AS mes,
  CASE WHEN n >= 5 THEN round(media, 1)::text ELSE 'menos de 5' END AS media,
  CASE WHEN n < 5 THEN NULL WHEN n < 10 THEN '5–9' WHEN n < 20 THEN '10–19' WHEN n < 50 THEN '20–49' ELSE '50+' END AS personas,
  CASE WHEN n >= 5 AND (c1 = 0 OR c1 >= 5) AND (c2 = 0 OR c2 >= 5) AND (c3 = 0 OR c3 >= 5) AND (c4 = 0 OR c4 >= 5) AND (c5 = 0 OR c5 >= 5)
    THEN concat_ws(' / ', c1, c2, c3, c4, c5) END AS "distribución 1–5"
FROM agg
ORDER BY m DESC;
```

**Evolución:**

```sql
WITH bounds AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AS this_month
), per_person AS (
  SELECT
    (array_agg(score ORDER BY "createdAt" ASC))[1]  AS primera,
    (array_agg(score ORDER BY "createdAt" DESC))[1] AS ultima
  FROM "PeaceCheckin", bounds
  WHERE score BETWEEN 1 AND 5 AND "createdAt" < this_month
  GROUP BY "userId"
  HAVING count(*) >= 2
), t AS (
  SELECT count(*) AS n,
    count(*) FILTER (WHERE ultima > primera) AS suben,
    count(*) FILTER (WHERE ultima = primera) AS igual,
    count(*) FILTER (WHERE ultima < primera) AS bajan
  FROM per_person
), ok AS (
  SELECT *, (suben >= 5 AND igual >= 5 AND bajan >= 5) AS safe FROM t
)
SELECT
  CASE WHEN NOT safe THEN 'sin datos suficientes'
       WHEN n < 20 THEN '10–19' WHEN n < 50 THEN '20–49' ELSE '50+' END AS personas,
  CASE WHEN safe THEN suben END AS suben,
  CASE WHEN safe THEN igual END AS igual,
  CASE WHEN safe THEN bajan END AS bajan
FROM ok;
```

(Con suben, igual y bajan de 5 o más cada uno, hay al menos 15 personas: la franja empieza en "10–19".)

No escribas otras consultas sobre `PeaceCheckin` que devuelvan filas sueltas ni recuentos exactos: la promesa de privacidad dice que Luis solo ve la media de cada mes cerrado cuando han respondido 5 personas o más.
