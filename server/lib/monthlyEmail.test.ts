// Run with:  node --import tsx --test server/lib/monthlyEmail.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lastEndedPeriod } from "./monthlyEmail.js";

test("the period summed up is the one that just ended, by payday", () => {
  const dec1 = new Date(Date.UTC(2026, 11, 1, 8));
  assert.equal(lastEndedPeriod(1, dec1), "2026-11");   // calendar month: November
  assert.equal(lastEndedPeriod(25, dec1), "2026-11");  // 25 Oct – 25 Nov
  const jan1 = new Date(Date.UTC(2027, 0, 1, 8));
  assert.equal(lastEndedPeriod(1, jan1), "2026-12");
});

test("the job's time budget leaves room under the function's maxDuration", async () => {
  const { MONTHLY_EMAIL_BUDGET_MS } = await import("./monthlyEmail.js");
  const fs = await import("node:fs");
  const vercel = JSON.parse(fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  // The budget, plus one last send (the transports time out at 10 s), fits.
  assert.ok(MONTHLY_EMAIL_BUDGET_MS + 10_000 < vercel.functions["api/index.ts"].maxDuration * 1000);
});
