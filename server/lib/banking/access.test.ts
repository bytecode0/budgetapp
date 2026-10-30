// Switch, allow-list, cron auth, signed hand-off and link ownership.
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ??= "test-secret";
const { allowedBankingEmails, bankingAllowedFor, bankingConfig } = await import("./config.js");
const { cronAuthorized, dueExpiryEmail, CRON_BUDGET_MS } = await import("./cron.js");
const { createConnectState, createExchangeToken, readConnectState, readExchangeToken, newBankingNonce } = await import("./handoff.js");
const { planLinks, LINK_ERRORS } = await import("./link.js");
const { signToken, verifyToken } = await import("../jwt.js");
type BankProviderAccount = import("./types.js").BankProviderAccount;
type LocalAccount = import("./link.js").LocalAccount;

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

test("banking is on only with every variable set; any missing one turns it off", () => {
  withEnv(FULL, () => {
    const config = bankingConfig()!;
    assert.equal(config.appId, "app");
    assert.equal(config.privateKey, "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
  });
  for (const missing of Object.keys(FULL)) {
    withEnv({ ...FULL, [missing]: undefined }, () => assert.equal(bankingConfig(), null, missing));
    withEnv({ ...FULL, [missing]: "   " }, () => assert.equal(bankingConfig(), null, `${missing} blank`));
  }
});

test("allow-list: case- and space-insensitive; unset or empty means nobody", () => {
  withEnv({ BANKING_ALLOWED_EMAILS: " Luis@Example.com , ana@example.com,," }, () => {
    assert.deepEqual([...allowedBankingEmails()], ["luis@example.com", "ana@example.com"]);
    assert.equal(bankingAllowedFor("luis@example.com"), true);
    assert.equal(bankingAllowedFor(" LUIS@example.COM "), true);
    assert.equal(bankingAllowedFor("eve@example.com"), false);
    assert.equal(bankingAllowedFor(null), false);
  });
  withEnv({}, () => assert.equal(bankingAllowedFor("luis@example.com"), false));
  withEnv({ BANKING_ALLOWED_EMAILS: "" }, () => assert.equal(bankingAllowedFor("luis@example.com"), false));
});

test("cron auth: exactly 'Bearer <CRON_SECRET>'; nothing passes without a secret", () => {
  assert.equal(cronAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(cronAuthorized("Bearer s3cre", "s3cret"), false);
  assert.equal(cronAuthorized("s3cret", "s3cret"), false);
  assert.equal(cronAuthorized("bearer s3cret", "s3cret"), false);
  assert.equal(cronAuthorized(undefined, "s3cret"), false);
  assert.equal(cronAuthorized("Bearer ", ""), false);
  assert.equal(cronAuthorized("Bearer undefined", undefined), false);
});

test("expiry email: once, within 7 days of expiry, not after it", () => {
  const now = new Date("2026-10-29T05:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
  assert.equal(dueExpiryEmail({ expiresAt: inDays(6), expiryWarnedAt: null }, now), true);
  assert.equal(dueExpiryEmail({ expiresAt: inDays(7), expiryWarnedAt: null }, now), true);
  assert.equal(dueExpiryEmail({ expiresAt: inDays(8), expiryWarnedAt: null }, now), false);
  assert.equal(dueExpiryEmail({ expiresAt: inDays(6), expiryWarnedAt: now }, now), false);
  assert.equal(dueExpiryEmail({ expiresAt: inDays(-1), expiryWarnedAt: null }, now), false);
  assert.equal(dueExpiryEmail({ expiresAt: null, expiryWarnedAt: null }, now), false);
});

test("connect state: bound to the cookie nonce, the user and the connection", () => {
  const nonce = newBankingNonce();
  const state = createConnectState({ connectionId: "c1", userId: "u1", nonce });
  assert.deepEqual(readConnectState(state, nonce), { connectionId: "c1", userId: "u1" });
  assert.equal(readConnectState(state, newBankingNonce()), null); // started in another browser
  assert.equal(readConnectState(state, undefined), null);
  assert.equal(readConnectState("garbage", nonce), null);
  // Other tokens are not a state.
  assert.equal(readConnectState(createExchangeToken({ connectionId: "c1", userId: "u1" }), nonce), null);
  assert.equal(readConnectState(signToken({ userId: "u1" }), nonce), null);
});

test("an expired or foreign-signed state is rejected", () => {
  const nonce = "n";
  const expired = jwt.sign({ purpose: "banking_connect", sub: "u1", connectionId: "c1", nonce, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET!);
  assert.equal(readConnectState(expired, nonce), null);
  const forged = jwt.sign({ purpose: "banking_connect", sub: "u1", connectionId: "c1", nonce }, "attacker-secret");
  assert.equal(readConnectState(forged, nonce), null);
});

test("hand-off tokens are never session cookies and only read as exchange tokens", () => {
  const token = createExchangeToken({ connectionId: "c1", userId: "u1" });
  assert.deepEqual(readExchangeToken(token), { connectionId: "c1", userId: "u1" });
  assert.equal(verifyToken(token).userId, undefined); // requireAuth reads payload.userId
  assert.equal(verifyToken(createConnectState({ connectionId: "c1", userId: "u1", nonce: "n" })).userId, undefined);
  assert.equal(readExchangeToken(createConnectState({ connectionId: "c1", userId: "u1", nonce: "n" })), null);
  assert.equal(readExchangeToken(signToken({ purpose: "google_exchange", sub: "u1" }, "2m")), null);
  assert.equal(readExchangeToken(42), null);
});

// ── Linking: ownership and card rules ──
const ME = "me", PARTNER = "partner", POOL = "pool";
const bank = (id: string, kind: BankProviderAccount["kind"], name?: string): BankProviderAccount => ({ id, kind, currency: "EUR", ...(name ? { name } : {}) });
const local = (over: Partial<LocalAccount> & { id: string }): LocalAccount =>
  ({ userId: POOL, ownerUserId: ME, visibility: "household", type: "checking", isArchived: false, ...over });
const PROVIDER = [bank("u-cur", "checking", "Cuenta Online"), bank("u-card", "card", "Aqua"), bank("u-sav", "savings")];
const LOCAL = [
  local({ id: "mine" }),
  local({ id: "my-card", type: "card" }),
  local({ id: "partner-shared", ownerUserId: PARTNER }),
  local({ id: "partner-private", ownerUserId: PARTNER, visibility: "private" }),
  local({ id: "archived", isArchived: true }),
  local({ id: "other-pool", userId: "elsewhere" }),
];
const ctx = { userId: POOL, authUserId: ME };

test("link: to my own accounts, or new ones (a bank card always becomes a card)", () => {
  const plan = planLinks([
    { externalAccountId: "u-cur", accountId: "mine" },
    { externalAccountId: "u-card", create: { name: "", type: "checking" } },
    { externalAccountId: "u-sav", create: { name: " Ahorro ", type: "savings" } },
  ], PROVIDER, LOCAL, ctx);
  assert.ok("actions" in plan);
  assert.deepEqual(plan.actions.map(a => ("accountId" in a ? a.accountId : a.create)), [
    "mine", { name: "Aqua", type: "card" }, { name: "Ahorro", type: "savings" },
  ]);
});

test("link: never to a partner's account — private ones don't exist, shared ones are read-only", () => {
  assert.deepEqual(planLinks([{ externalAccountId: "u-cur", accountId: "partner-private" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.accountNotFound);
  assert.deepEqual(planLinks([{ externalAccountId: "u-cur", accountId: "partner-shared" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.notOwner);
  assert.deepEqual(planLinks([{ externalAccountId: "u-cur", accountId: "other-pool" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.accountNotFound);
  assert.deepEqual(planLinks([{ externalAccountId: "u-cur", accountId: "archived" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.accountNotFound);
});

test("link: a bank card only to a card account, a bank account never to a card", () => {
  assert.deepEqual(planLinks([{ externalAccountId: "u-card", accountId: "mine" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.typeMismatch);
  assert.deepEqual(planLinks([{ externalAccountId: "u-cur", accountId: "my-card" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.typeMismatch);
  const ok = planLinks([{ externalAccountId: "u-card", accountId: "my-card" }], PROVIDER, LOCAL, ctx);
  assert.ok("actions" in ok);
});

test("link: only accounts of this consent, each once, never two onto one", () => {
  assert.deepEqual(planLinks([{ externalAccountId: "someone-elses-uid", accountId: "mine" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.unknownBankAccount);
  assert.deepEqual(planLinks([
    { externalAccountId: "u-cur", accountId: "mine" }, { externalAccountId: "u-cur", create: {} },
  ], PROVIDER, LOCAL, ctx), LINK_ERRORS.unknownBankAccount);
  assert.deepEqual(planLinks([
    { externalAccountId: "u-cur", accountId: "mine" }, { externalAccountId: "u-sav", accountId: "mine" },
  ], PROVIDER, LOCAL, ctx), LINK_ERRORS.duplicateTarget);
  assert.deepEqual(planLinks([], PROVIDER, LOCAL, ctx), LINK_ERRORS.invalid);
  assert.deepEqual(planLinks("nope", PROVIDER, LOCAL, ctx), LINK_ERRORS.invalid);
  assert.deepEqual(planLinks([{ externalAccountId: "u-cur" }], PROVIDER, LOCAL, ctx), LINK_ERRORS.invalid);
});

test("the cron budget leaves room under the function's maxDuration", async () => {
  const fs = await import("node:fs");
  const vercel = JSON.parse(fs.readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));
  const maxDuration = vercel.functions["api/index.ts"].maxDuration;
  assert.equal(maxDuration, 60);
  // The budget, plus one account's slowest calls (each request times out at 15 s), fits.
  assert.ok(CRON_BUDGET_MS + 2 * 15_000 < maxDuration * 1000);
  assert.deepEqual(vercel.crons, [{ path: "/api/banking/cron", schedule: "0 5 * * *" }]);
});
