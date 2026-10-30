import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  EnableBankingClient, EnableBankingError, MAX_TRANSACTION_PAGES, accountKind, decimalToCents, enableBankingJwt,
  mapTransaction, pickBalance, psuHeadersFrom,
} from "./enableBanking.js";
import { normalizePem } from "./config.js";

// A throwaway key, generated per run: no key is ever committed.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CONFIG = { appId: "app-123", privateKey: PEM, callbackUrl: "https://example.test/api/banking/callback" };
const IBAN = "ES9121000418450200051332";

interface Call { url: URL; init: RequestInit }
function mockFetch(responses: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const impl = async (input: string, init?: RequestInit) => {
    const call = { url: new URL(input), init: init ?? {} };
    calls.push(call);
    const { status = 200, body } = responses(call);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, impl };
}

const bearer = (call: Call) => String((call.init.headers as Record<string, string>).Authorization).replace(/^Bearer /, "");

test("the JWT is RS256 with kid = app id and Enable Banking's fixed claims, valid 1 h", () => {
  const now = 1_800_000_000;
  const token = enableBankingJwt(CONFIG, now);
  const decoded = jwt.decode(token, { complete: true })!;
  assert.equal(decoded.header.alg, "RS256");
  assert.equal(decoded.header.typ, "JWT");
  assert.equal(decoded.header.kid, "app-123");
  const payload = decoded.payload as jwt.JwtPayload;
  assert.equal(payload.iss, "enablebanking.com");
  assert.equal(payload.aud, "api.enablebanking.com");
  assert.equal(payload.iat, now);
  assert.equal(payload.exp, now + 3600);
  // Signed with the app's key.
  jwt.verify(token, publicKey.export({ type: "spki", format: "pem" }).toString(), { algorithms: ["RS256"], clockTimestamp: now });
});

test("a PEM with literal \\n escapes signs the same as the multi-line one", () => {
  const oneLine = PEM.replace(/\n/g, "\\n");
  const token = enableBankingJwt({ ...CONFIG, privateKey: normalizePem(oneLine) }, 1_800_000_000);
  assert.equal(jwt.decode(token, { complete: true })!.header.kid, "app-123");
});

test("an invalid key fails with a message that never contains the key", () => {
  const bad = "-----BEGIN PRIVATE KEY-----\nNOTAKEYsecretmaterial\n-----END PRIVATE KEY-----";
  assert.throws(() => enableBankingJwt({ ...CONFIG, privateKey: bad }), (err: Error) => {
    assert.match(err.message, /ENABLE_BANKING_PRIVATE_KEY/);
    assert.doesNotMatch(err.message, /secretmaterial|BEGIN/);
    return true;
  });
});

test("every request carries a fresh signed bearer JWT", async () => {
  const { calls, impl } = mockFetch(() => ({ body: { aspsps: [] } }));
  await new EnableBankingClient(CONFIG, impl).listInstitutions("ES");
  const decoded = jwt.decode(bearer(calls[0]), { complete: true })!;
  assert.equal(decoded.header.kid, "app-123");
  assert.equal(calls[0].url.origin, "https://api.enablebanking.com");
  assert.equal(calls[0].url.pathname, "/aspsps");
  assert.equal(calls[0].url.searchParams.get("country"), "ES");
  assert.equal(calls[0].url.searchParams.get("psu_type"), "personal");
});

test("listInstitutions keeps personal banks, sorted, with consent days", async () => {
  const { impl } = mockFetch(() => ({
    body: {
      aspsps: [
        { name: "Santander", country: "ES", logo: "https://l/s.png", psu_types: ["personal", "business"], maximum_consent_validity: 15552000 },
        { name: "BBVA", country: "ES", logo: "https://l/b.png", psu_types: ["personal"], maximum_consent_validity: 7776000 },
        { name: "Corp Bank", country: "ES", psu_types: ["business"], maximum_consent_validity: 7776000 },
      ],
    },
  }));
  const list = await new EnableBankingClient(CONFIG, impl).listInstitutions("ES");
  assert.deepEqual(list.map(i => [i.name, i.maxConsentDays]), [["BBVA", 90], ["Santander", 180]]);
});

test("startAuthorization posts aspsp name+country, state, redirect_url, valid_until and psu_type", async () => {
  const { calls, impl } = mockFetch(() => ({ body: { url: "https://bank.test/consent", authorization_id: "a1" } }));
  const validUntil = new Date("2027-04-27T00:00:00.000Z");
  const { url } = await new EnableBankingClient(CONFIG, impl).startAuthorization({
    institution: { name: "BBVA", country: "ES" }, state: "st", redirectUrl: CONFIG.callbackUrl, validUntil, language: "es",
  });
  assert.equal(url, "https://bank.test/consent");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    access: { valid_until: "2027-04-27T00:00:00.000Z", balances: true, transactions: true },
    aspsp: { name: "BBVA", country: "ES" },
    state: "st",
    redirect_url: CONFIG.callbackUrl,
    psu_type: "personal",
    language: "es",
  });
});

test("createSession maps accounts: uid, last 4 of the IBAN only, kind from cash_account_type", async () => {
  const { impl } = mockFetch(() => ({
    body: {
      session_id: "sess-1",
      access: { valid_until: "2027-04-27T10:00:00+00:00" },
      accounts: [
        { uid: "u1", account_id: { iban: IBAN }, name: "Cuenta Online", cash_account_type: "CACC", currency: "EUR", identification_hash: "h" },
        { uid: "u2", product: "Tarjeta Aqua", cash_account_type: "CARD", currency: "EUR", identification_hash: "h2" },
        { account_id: { iban: IBAN }, cash_account_type: "CACC", currency: "EUR", identification_hash: "h3" }, // no uid: unusable
      ],
    },
  }));
  const s = await new EnableBankingClient(CONFIG, impl).createSession("code-1");
  assert.equal(s.sessionId, "sess-1");
  assert.equal(s.validUntil?.toISOString(), "2027-04-27T10:00:00.000Z");
  assert.deepEqual(s.accounts, [
    { id: "u1", name: "Cuenta Online", ibanLast4: "1332", currency: "EUR", kind: "checking", stableKey: "h" },
    { id: "u2", name: "Tarjeta Aqua", currency: "EUR", kind: "card", stableKey: "h2" },
  ]);
  assert.doesNotMatch(JSON.stringify(s), new RegExp(IBAN));
});

test("accountKind: CARD is a card, SVGS savings, the rest a current account", () => {
  assert.equal(accountKind("CARD"), "card");
  assert.equal(accountKind("SVGS"), "savings");
  assert.equal(accountKind("CACC"), "checking");
  assert.equal(accountKind("OTHR"), "checking");
  assert.equal(accountKind(undefined), "checking");
});

test("decimalToCents is exact and never rounds silently", () => {
  assert.equal(decimalToCents("12.34"), 1234);
  assert.equal(decimalToCents("-5"), -500);
  assert.equal(decimalToCents("0.5"), 50);
  assert.equal(decimalToCents("0.10"), 10);
  assert.equal(decimalToCents("1234567.89"), 123456789);
  assert.equal(decimalToCents("1.230"), 123);
  assert.equal(decimalToCents("1.234"), null);
  assert.equal(decimalToCents("1,23"), null);
  assert.equal(decimalToCents(""), null);
  assert.equal(decimalToCents(undefined), null);
  // 0.1 + 0.2 style float drift can't happen: parsed from the string.
  assert.equal(decimalToCents("0.29"), 29);
});

test("mapTransaction: the sign comes from credit_debit_indicator", () => {
  const base = { status: "BOOK", booking_date: "2026-10-20", transaction_amount: { amount: "45.50", currency: "EUR" } };
  assert.equal(mapTransaction({ ...base, credit_debit_indicator: "DBIT" })!.amountCents, -4550);
  assert.equal(mapTransaction({ ...base, credit_debit_indicator: "CRDT" })!.amountCents, 4550);
  // A negative amount string doesn't flip it twice.
  assert.equal(mapTransaction({ ...base, transaction_amount: { amount: "-45.50" }, credit_debit_indicator: "DBIT" })!.amountCents, -4550);
  // No direction: not guessed.
  assert.equal(mapTransaction({ ...base }), null);
  assert.equal(mapTransaction({ ...base, credit_debit_indicator: "DBIT", transaction_amount: { amount: "abc" } }), null);
  assert.equal(mapTransaction({ ...base, credit_debit_indicator: "DBIT", booking_date: null }), null);
});

test("mapTransaction: id, counterparty as description, remittance as details, value date fallback", () => {
  const t = mapTransaction({
    transaction_id: "tx-9", entry_reference: "ref-1", status: "BOOK", credit_debit_indicator: "DBIT",
    value_date: "2026-10-19", transaction_amount: { amount: "12.00", currency: "EUR" },
    creditor: { name: "MERCADONA" }, remittance_information: ["COMPRA TARJ 1234", "MADRID"],
    balance_after_transaction: { amount: "988.00" },
  })!;
  assert.equal(t.id, "tx-9");
  assert.equal(t.date, "2026-10-19");
  assert.equal(t.description, "MERCADONA");
  assert.equal(t.details, "COMPRA TARJ 1234 MADRID");
  assert.equal(t.balanceAfterCents, 98800);
  // No transaction_id → entry_reference; neither → null (content hash later).
  assert.equal(mapTransaction({ entry_reference: "ref-1", status: "BOOK", credit_debit_indicator: "CRDT", booking_date: "2026-10-19", transaction_amount: { amount: "1" } })!.id, "ref-1");
  const noId = mapTransaction({ status: "BOOK", credit_debit_indicator: "CRDT", booking_date: "2026-10-19", transaction_amount: { amount: "1" }, remittance_information: ["NOMINA"] })!;
  assert.equal(noId.id, null);
  assert.equal(noId.description, "NOMINA");
});

test("transactions: every page via continuation_key, BOOK only, pending and malformed counted", async () => {
  const pages: Record<string, unknown> = {
    "": {
      transactions: [
        { transaction_id: "a", status: "BOOK", credit_debit_indicator: "DBIT", booking_date: "2026-10-01", transaction_amount: { amount: "10.00" } },
        { transaction_id: "p", status: "PDNG", credit_debit_indicator: "DBIT", booking_date: "2026-10-02", transaction_amount: { amount: "5.00" } },
      ],
      continuation_key: "k2",
    },
    k2: {
      transactions: [
        { transaction_id: "b", status: "BOOK", credit_debit_indicator: "CRDT", booking_date: "2026-10-03", transaction_amount: { amount: "20.00" } },
        { transaction_id: "bad", status: "BOOK", booking_date: "2026-10-03", transaction_amount: { amount: "1.00" } },
      ],
      continuation_key: "k3",
    },
    k3: { transactions: [], continuation_key: null },
  };
  const { calls, impl } = mockFetch(call => ({ body: pages[call.url.searchParams.get("continuation_key") ?? ""] }));
  const res = await new EnableBankingClient(CONFIG, impl).getAccountTransactions("uid-1", "2026-08-01");
  assert.deepEqual(res.booked.map(t => [t.id, t.amountCents]), [["a", -1000], ["b", 2000]]);
  assert.equal(res.pendingCount, 1);
  assert.equal(res.invalidCount, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.pathname, "/accounts/uid-1/transactions");
  assert.ok(calls.every(c => c.url.searchParams.get("date_from") === "2026-08-01"));
});

test("transactions: a provider that never stops paginating is cut off", async () => {
  const { calls, impl } = mockFetch(() => ({ body: { transactions: [], continuation_key: "again" } }));
  await assert.rejects(new EnableBankingClient(CONFIG, impl).getAccountTransactions("uid-1", "2026-08-01"), EnableBankingError);
  assert.equal(calls.length, MAX_TRANSACTION_PAGES);
});

test("pickBalance: a card only takes a booked balance, an account prefers booked then available", () => {
  const balances = [
    { balance_type: "CLAV", balance_amount: { amount: "2500.00", currency: "EUR" } },
    { balance_type: "CLBD", balance_amount: { amount: "-480.20", currency: "EUR" }, reference_date: "2026-10-27" },
    { balance_type: "CLBD", balance_amount: { amount: "-400.00", currency: "EUR" }, reference_date: "2026-10-26" },
  ];
  assert.deepEqual(pickBalance(balances, "card"), { amountCents: -48020, currency: "EUR", type: "CLBD", referenceDate: "2026-10-27" });
  // Opening / previously-closed balances leave out later movements: never a card's.
  assert.equal(pickBalance([
    { balance_type: "OPBD", balance_amount: { amount: "-100.00" } },
    { balance_type: "PRCD", balance_amount: { amount: "-90.00" } },
  ], "card"), null);
  assert.equal(pickBalance([balances[0]], "card"), null); // available credit is not what's owed
  assert.equal(pickBalance([balances[0]], "checking")!.amountCents, 250000);
});

test("errors carry status and provider code, never the key, a token, a uid, an IBAN or the body", async () => {
  const { calls, impl } = mockFetch(() => ({
    status: 422,
    body: { message: `Account ${IBAN} is closed`, code: 422, error: "ASPSP_ERROR", detail: { iban: IBAN } },
  }));
  const client = new EnableBankingClient(CONFIG, impl);
  const err = await client.getAccountTransactions("secret-uid-77", "2026-08-01").catch(e => e) as EnableBankingError;
  assert.ok(err instanceof EnableBankingError);
  assert.equal(err.status, 422);
  assert.equal(err.providerCode, "ASPSP_ERROR");
  const text = `${err.message} ${err.stack} ${JSON.stringify(err)}`;
  assert.doesNotMatch(text, new RegExp(IBAN));
  assert.doesNotMatch(text, /secret-uid-77/);
  assert.doesNotMatch(text, /BEGIN|PRIVATE/);
  assert.ok(!text.includes(bearer(calls[0])));
  assert.ok(!text.includes("is closed"));
});

test("a non-code error field from the provider is not echoed", async () => {
  const { impl } = mockFetch(() => ({ status: 400, body: { message: "bad", error: `contains ${IBAN}` } }));
  const err = await new EnableBankingClient(CONFIG, impl).listInstitutions("ES").catch(e => e) as EnableBankingError;
  assert.equal(err.providerCode, null);
  assert.doesNotMatch(err.message, new RegExp(IBAN));
});

test("a network failure becomes a clean error with no URL ids", async () => {
  const client = new EnableBankingClient(CONFIG, async () => { throw new Error(`connect ECONNREFUSED /sessions/sess-secret`); });
  const err = await client.getSession("sess-secret").catch(e => e) as EnableBankingError;
  assert.equal(err.status, 0);
  assert.doesNotMatch(err.message, /sess-secret/);
});

test("getSession reads status, accounts and valid_until; deleteSession sends DELETE", async () => {
  const { calls, impl } = mockFetch(call => (call.init.method === "DELETE"
    ? { body: { message: "OK" } }
    : { body: { status: "EXPIRED", accounts: ["u1"], access: { valid_until: "2026-10-01T00:00:00Z" } } }));
  const client = new EnableBankingClient(CONFIG, impl);
  const s = await client.getSession("sess-1");
  assert.equal(s.authorized, false);
  assert.equal(s.status, "EXPIRED");
  assert.deepEqual(s.accountIds, ["u1"]);
  await client.deleteSession("sess-1");
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(calls[1].url.pathname, "/sessions/sess-1");
});

test("PSU headers come from the user's request; none without an IP, no multi-line values", () => {
  const h = psuHeadersFrom("81.0.0.1", {
    "user-agent": "Mozilla/5.0", "accept-language": "es-ES", referer: "https://budget.luisvespa.com/", accept: "*/*", "x-other": "no",
  });
  assert.deepEqual(h, {
    "Psu-Ip-Address": "81.0.0.1", "Psu-User-Agent": "Mozilla/5.0", "Psu-Referer": "https://budget.luisvespa.com/",
    "Psu-Accept": "*/*", "Psu-Accept-language": "es-ES",
  });
  assert.deepEqual(psuHeadersFrom(undefined, { "user-agent": "x" }), {});
  assert.equal(psuHeadersFrom("1.1.1.1", { "user-agent": "a\r\nInjected: 1" })["Psu-User-Agent"], undefined);
});

test("PSU headers go on bank calls, not on the bank list; the cron's client sends none", async () => {
  const psu = { "Psu-Ip-Address": "81.0.0.1", "Psu-User-Agent": "Mozilla/5.0" };
  const { calls, impl } = mockFetch(call => (call.url.pathname === "/aspsps" ? { body: { aspsps: [] } } : { body: { balances: [] } }));
  const client = new EnableBankingClient(CONFIG, impl, psu);
  await client.listInstitutions("ES");
  await client.getAccountBalance("u1", "checking");
  const headersOf = (c: Call) => c.init.headers as Record<string, string>;
  assert.equal(headersOf(calls[0])["Psu-Ip-Address"], undefined);
  assert.equal(headersOf(calls[1])["Psu-Ip-Address"], "81.0.0.1");
  assert.equal(headersOf(calls[1])["Psu-User-Agent"], "Mozilla/5.0");
  const unattended = mockFetch(() => ({ body: { balances: [] } }));
  await new EnableBankingClient(CONFIG, unattended.impl).getAccountBalance("u1", "checking");
  assert.ok(!Object.keys(headersOf(unattended.calls[0])).some(k => k.startsWith("Psu-")));
});

test("a bank that wants more PSU headers than we have gets none (all or none)", async () => {
  const { calls, impl } = mockFetch(call => ((call.init.headers as Record<string, string>)["Psu-Ip-Address"]
    ? { status: 400, body: { message: "missing", error: "PSU_HEADER_NOT_PROVIDED" } }
    : { body: { balances: [{ balance_type: "ITBD", balance_amount: { amount: "1.00" } }] } }));
  const balance = await new EnableBankingClient(CONFIG, impl, { "Psu-Ip-Address": "81.0.0.1" }).getAccountBalance("u1", "checking");
  assert.equal(balance?.amountCents, 100);
  assert.equal(calls.length, 2);
});
