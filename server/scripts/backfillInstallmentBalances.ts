// One-off: give installment plans created before POST /api/debts stored a
// starting balance (server/lib/debtBalance.ts, startingBalanceFor) the
// balance they'd get today — (installmentsTotal − installmentsPaid) ×
// installmentAmount — so the ledger alone says what's owed.
//
// Only touches ACTIVE plans (paymentMode "installments") with a starting
// balance of 0, a cuota and a number of cuotas, and NO movements at all
// (payments, purchases, adjustments): with movements, an anchor change would
// rewrite closed months. Idempotent: a plan it fixed no longer has a 0 anchor.
//
// Dry run by default — prints what it would change. Writes only with --apply.
//
// Run:  npm run backfill:installments            (dry run)
//       npm run backfill:installments -- --apply (write)
import { prisma } from "../lib/prisma.js";
import { loadDebtLedgers, startingBalanceFor } from "../lib/debtBalance.js";

(async () => {
  const apply = process.argv.includes("--apply");

  const candidates = await prisma.debt.findMany({
    where: {
      status: "active",
      paymentMode: "installments",
      kind: { not: "credit_card" },
      currentBalance: 0,
      installmentAmount: { gt: 0 },
      installmentsTotal: { not: null },
    },
    select: { id: true, userId: true, name: true, paymentMode: true, currentBalance: true, installmentAmount: true, installmentsTotal: true, installmentsPaid: true },
  });

  let changed = 0;
  let skipped = 0;
  for (const d of candidates) {
    const [ledger] = await loadDebtLedgers(d.userId, [d.id]);
    if (!ledger) continue;
    if (ledger.payments.length + ledger.purchases.length + ledger.adjustments.length > 0) {
      console.log(`skip   ${d.id} "${d.name}": has movements`);
      skipped++;
      continue;
    }
    const starting = startingBalanceFor(d);
    if (starting <= 0) continue;
    console.log(`${apply ? "set   " : "would "} ${d.id} "${d.name}": starting balance 0 → ${(starting / 100).toFixed(2)} (${d.installmentsTotal! - (d.installmentsPaid ?? 0)} × ${(d.installmentAmount! / 100).toFixed(2)})`);
    if (apply) {
      await prisma.debt.update({ where: { id: d.id }, data: { currentBalance: starting, balanceAsOf: new Date() } });
    }
    changed++;
  }

  console.log(`\n${candidates.length} candidate(s): ${changed} ${apply ? "updated" : "to update"}, ${skipped} skipped (movements).`);
  if (!apply && changed > 0) console.log("Dry run — nothing written. Re-run with --apply to write.");
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
