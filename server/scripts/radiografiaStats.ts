// The "dashboard" for now: prints funnel counts, data-completeness counts,
// and brand popularity to the terminal — no UI, per the product owner's own
// framing ("aunque tenga que mirarlo en la base de datos del servidor").
//
// Data-completeness counts (salary/essentials/debts/ant-expenses/subscriptions
// present) come from tables that already exist and need no new schema:
// completed profiles (`onboardingCompletedAt != null`) are never purged by
// internalPurge.ts, so ProfileFieldValue/ProfileDebt/Radiografia.resultado
// already hold this forever. Funnel and brand counts come from the two new
// anonymous tables (RadiografiaFunnelEvent, RadiografiaBrandInsight) added
// alongside this script.
//
// Usage: npx tsx server/scripts/radiografiaStats.ts
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import type { RadiografiaSnapshot } from "../lib/radiografia/report.js";

async function main() {
  const completed = await prisma.financialProfile.findMany({
    where: { onboardingCompletedAt: { not: null } },
    select: { id: true, incomeType: true },
  });
  const completedIds = completed.map((p) => p.id);
  const total = completedIds.length;

  console.log(`\n=== Radiografías completadas: ${total} ===`);
  if (total === 0) {
    console.log("(nada que reportar todavía)");
    await prisma.$disconnect();
    return;
  }

  const [fieldValues, debtProfileIds, debtsNoneProfileIds, radiografias] = await Promise.all([
    prisma.profileFieldValue.findMany({
      where: { profileId: { in: completedIds }, fieldKey: { in: ["income_regular", "income_floor", "essentials_total"] } },
      select: { profileId: true, fieldKey: true },
    }),
    prisma.profileDebt.findMany({ where: { profileId: { in: completedIds } }, select: { profileId: true }, distinct: ["profileId"] }),
    prisma.profileFieldValue.findMany({ where: { profileId: { in: completedIds }, fieldKey: "debts_confirmed_none" }, select: { profileId: true } }),
    prisma.radiografia.findMany({ where: { profileId: { in: completedIds }, version: 1 }, select: { resultado: true } }),
  ]);

  const withIncome = new Set(fieldValues.filter((f) => f.fieldKey === "income_regular" || f.fieldKey === "income_floor").map((f) => f.profileId)).size;
  const withEssentials = new Set(fieldValues.filter((f) => f.fieldKey === "essentials_total").map((f) => f.profileId)).size;
  const withDebtsAnswered = new Set([...debtProfileIds.map((d) => d.profileId), ...debtsNoneProfileIds.map((d) => d.profileId)]).size;
  const withActualDebt = new Set(debtProfileIds.map((d) => d.profileId)).size;

  let withExtracto = 0, withAntExpenses = 0, withSubscriptions = 0;
  for (const r of radiografias) {
    const snapshot = r.resultado as unknown as RadiografiaSnapshot;
    if (snapshot.months > 0) withExtracto++;
    if (snapshot.antExpenses) withAntExpenses++;
    if (snapshot.recurring) withSubscriptions++;
  }

  const pct = (n: number) => `${n} (${Math.round((n / total) * 100)}%)`;
  console.log(`Subieron extracto:        ${pct(withExtracto)}`);
  console.log(`Con salario registrado:   ${pct(withIncome)}`);
  console.log(`Con gastos esenciales:    ${pct(withEssentials)}`);
  console.log(`Respondieron sobre deudas: ${pct(withDebtsAnswered)}  (de las cuales con deuda real: ${withActualDebt})`);
  console.log(`Con gastos hormiga:       ${pct(withAntExpenses)}`);
  console.log(`Con suscripciones:        ${pct(withSubscriptions)}`);

  console.log(`\n=== Embudo (RadiografiaFunnelEvent) ===`);
  const funnelCounts = await prisma.radiografiaFunnelEvent.groupBy({
    by: ["event", "paso"],
    _count: { _all: true },
    orderBy: [{ event: "asc" }, { paso: "asc" }],
  });
  if (!funnelCounts.length) console.log("(sin eventos todavía)");
  for (const row of funnelCounts) {
    console.log(`${row.event}${row.paso ? ` (paso ${row.paso})` : ""}: ${row._count._all}`);
  }

  console.log(`\n=== Marcas más comunes (RadiografiaBrandInsight) ===`);
  for (const kind of ["subscription", "ant"] as const) {
    const brands = await prisma.radiografiaBrandInsight.groupBy({
      by: ["brand"],
      where: { kind },
      _count: { _all: true },
      orderBy: { _count: { brand: "desc" } },
      take: 10,
    });
    console.log(`\n${kind === "subscription" ? "Suscripciones" : "Gastos hormiga"}:`);
    if (!brands.length) console.log("  (sin datos todavía)");
    for (const b of brands) console.log(`  ${b.brand}: ${b._count._all}`);
  }

  console.log("");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
