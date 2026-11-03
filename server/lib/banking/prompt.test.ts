// Banking outside Accounts: the access decision and its reasons, the
// dismissed "connect" prompt, what a partner sees of the owner's connection,
// and what a confirm reports as learned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bankingAccess } from "./config.js";
import { connectionForViewer, dismissBankPrompt, type PromptSettingsDb } from "./prompt.js";
import { learnablePairs } from "../ingest/confirm.js";

const VARS = ["ENABLE_BANKING_APP_ID", "ENABLE_BANKING_PRIVATE_KEY", "BANKING_CALLBACK_URL", "ENCRYPTION_KEY", "CRON_SECRET", "BANKING_ALLOWED_EMAILS"];
function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)));
  try { fn(); } finally {
    for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const FULL = {
  ENABLE_BANKING_APP_ID: "app", ENABLE_BANKING_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  BANKING_CALLBACK_URL: "http://localhost:3002/api/banking/callback", ENCRYPTION_KEY: "k", CRON_SECRET: "c",
};

test("access: not configured comes first, then the allow-list, then enabled", () => {
  withEnv({ BANKING_ALLOWED_EMAILS: "luis@example.com" }, () => {
    assert.deepEqual(bankingAccess({ email: "luis@example.com" }), { enabled: false, reason: "not_configured" });
  });
  withEnv({ ...FULL, BANKING_ALLOWED_EMAILS: "luis@example.com" }, () => {
    assert.deepEqual(bankingAccess({ email: "Luis@Example.com" }), { enabled: true });
    assert.deepEqual(bankingAccess({ email: "ana@example.com" }), { enabled: false, reason: "not_allowed" });
    assert.deepEqual(bankingAccess({ email: null }), { enabled: false, reason: "not_allowed" });
  });
  withEnv(FULL, () => {
    assert.deepEqual(bankingAccess({ email: "luis@example.com" }), { enabled: false, reason: "not_allowed" });
  });
});

function fakeDb() {
  const calls: unknown[] = [];
  const db: PromptSettingsDb = { userSettings: { upsert: async (args) => { calls.push(args); return {}; } } };
  return { db, calls };
}

test("dismissing the prompt writes the real person's settings, never the pool's", async () => {
  const { db, calls } = fakeDb();
  const now = new Date("2026-11-03T10:00:00Z");
  // A partner in the owner's pool (req.userId = "owner") dismisses it:
  await dismissBankPrompt(db, "partner", now);
  assert.deepEqual(calls, [{
    where: { userId: "partner" },
    update: { bankPromptDismissedAt: now },
    create: { userId: "partner", bankPromptDismissedAt: now },
  }]);
});

const account = (over: Partial<{ id: string; bankPendingReview: number; bankSyncNotice: string | null; bankReviewedAt: Date | null }> = {}) =>
  ({ id: "a1", bankPendingReview: 4, bankSyncNotice: "held_expired" as string | null, bankReviewedAt: new Date("2026-10-01"), ...over });

test("a connection's owner sees its pending reviews; a partner never does", () => {
  const connection = { id: "c1", ownerUserId: "owner", institutionName: "BBVA", lastSyncedAt: new Date("2026-11-03T07:00:00Z"), accounts: [account(), account({ id: "a2", bankReviewedAt: null })] };

  const mine = connectionForViewer(connection, "owner");
  assert.equal(mine.isOwner, true);
  assert.deepEqual(mine.accounts.map(a => [a.bankPendingReview, a.bankSyncNotice]), [[4, "held_expired"], [4, "held_expired"]]);

  const theirs = connectionForViewer(connection, "partner");
  assert.equal(theirs.isOwner, false);
  assert.deepEqual(theirs.accounts.map(a => [a.bankPendingReview, a.bankSyncNotice]), [[0, null], [0, null]]);
  // The status line stays: bank name and last sync.
  assert.equal(theirs.institutionName, "BBVA");
  assert.deepEqual(theirs.lastSyncedAt, connection.lastSyncedAt);
  // The original is untouched.
  assert.equal(connection.accounts[0].bankPendingReview, 4);
});

test("learned pairs: last assignment wins; refunds, card payment lines and generic payments don't teach", () => {
  const e = (over: Partial<Parameters<typeof learnablePairs>[0][number]>) =>
    ({ kind: "expense" as const, merchant: "mercadona", description: "MERCADONA SA 1234", allocationId: "groceries", debtId: null, accountId: "acc", ...over });
  const pairs = learnablePairs([
    e({}),
    e({ allocationId: "home", description: "Mercadona Valencia" }),       // last wins
    e({ merchant: "zara", kind: "refund", allocationId: "clothes" }),     // refund
    e({ merchant: "", allocationId: "x" }),                               // no merchant
    e({ merchant: "lidl", allocationId: null }),                          // uncategorised
    e({ merchant: "pago tarjeta", debtId: "d1", accountId: null, allocationId: "card" }), // card statement's own payment
    e({ merchant: "transferencia realizada", debtId: "d1", allocationId: "loan" }),       // generic bank payment
    e({ merchant: "cofidis prestamo", description: "  ", debtId: "d1", allocationId: "loan" }), // specific bank payment, no description
  ]);
  // The stored key stays the normalized merchant; the label is the row as shown.
  assert.deepEqual([...pairs], [
    ["mercadona", { allocationId: "home", label: "Mercadona Valencia" }],
    ["cofidis prestamo", { allocationId: "loan", label: "cofidis prestamo" }],
  ]);
});
