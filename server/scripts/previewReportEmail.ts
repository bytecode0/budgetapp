// Renders the Radiografía emails to disk without sending them — there is
// otherwise no way to look at this HTML, since sending requires a live
// RESEND_API_KEY. Writes the "ready" notification (now deliberately short —
// stage name, one line, a button to the web report; the rich detail lives
// only there since the split described in docs/scope-release.md's Épica 2)
// across three input variants, plus the separate eBook email that
// GET /report/:token triggers on first view.
//
// Usage: npx tsx server/scripts/previewReportEmail.ts
// Loads .env like the real server does, so EBOOK_URL/EBOOK_COVER_URL/APP_URL/
// PRIVACY_URL render exactly as they would in a real send. If
// RESEND_API_KEY isn't set in .env, pass a dummy one inline:
// RESEND_API_KEY=dummy npx tsx ... — mailer.ts constructs its Resend client
// at module load time, which throws on an unset key even though this script
// never calls send().
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRadiografiaEmailReport, type RadiografiaSnapshot } from "../lib/radiografia/report.js";
import { buildRadiografiaReportEmailContent, buildEbookEmailContent } from "../lib/mailer.js";

const fieldValues = [
  { fieldKey: "income_regular", valueCents: 250_000, source: "extracto" },
  { fieldKey: "housing_payment", valueCents: 90_000, source: "manual" },
  { fieldKey: "essentials_total", valueCents: 45_000, source: "manual" },
  { fieldKey: "saving_monthly", valueCents: 15_000, source: "extracto" },
  { fieldKey: "investment_monthly", valueCents: 10_000, source: "extracto" },
  { fieldKey: "giving_monthly", valueCents: 20_000, source: "extracto" },
  { fieldKey: "enjoyment_total", valueCents: 30_000, source: "manual" },
];

const debts = [{ kind: "credit_card", monthlyPayment: 55_000, source: "manual" }];

const snapshot: RadiografiaSnapshot = {
  months: 4,
  transactionCount: 214,
  categories: [
    { key: "restaurants", monthlyAvg: 120, annualized: 1440, pct: 0.32 },
    { key: "delivery", monthlyAvg: 70, annualized: 840, pct: 0.19 },
    { key: "supermarket", monthlyAvg: 180, annualized: 2160, pct: 0.49 },
  ],
  antExpenses: { monthlyAvg: 52, annualized: 624 },
  recurring: { monthlyTotal: 38, annualized: 456, count: 4 },
  health: { score: 68, pillars: [{ key: "savings", score: 70, weight: 0.25 }] },
  archetype: { key: "builder", givingAssessed: true },
  balances: { hasData: true, runwayMonths: 2.8 },
  opportunities: [
    { id: "halve_ant", params: {}, annualSaving: 312 },
    { id: "review_subscriptions", params: { count: 4 }, annualSaving: 114 },
    { id: "cut_dining_20", params: { pct: 20 }, annualSaving: 288 },
  ],
};

const names = {
  ant: [{ merchant: "Glovo", count: 11 }, { merchant: "Starbucks", count: 8 }],
  recurring: [{ merchant: "Netflix" }, { merchant: "Spotify" }],
};

const variants = {
  manual: buildRadiografiaEmailReport({
    fieldValues: fieldValues.filter((f) => f.source === "manual"),
    debts,
    incomeType: "regular",
    stageId: "cimientos",
    snapshot: null,
  }),
  extracto_con_nombres: buildRadiografiaEmailReport({
    fieldValues,
    debts,
    incomeType: "regular",
    stageId: "liberacion",
    snapshot,
    names,
  }),
  extracto_sin_nombres: buildRadiografiaEmailReport({
    fieldValues,
    debts,
    incomeType: "regular",
    stageId: "liberacion",
    snapshot,
  }),
};

for (const [name, report] of Object.entries(variants)) {
  const { html } = buildRadiografiaReportEmailContent(report, "preview-access-token", "preview-report-token-0000000000000000000000000000000000000000000000000000000000");
  const path = join(tmpdir(), `radiografia-report-${name}.html`);
  writeFileSync(path, html, "utf-8");
  console.log(`wrote ${path}`);
}

const ebookPath = join(tmpdir(), "radiografia-ebook.html");
writeFileSync(ebookPath, buildEbookEmailContent().html, "utf-8");
console.log(`wrote ${ebookPath}`);
