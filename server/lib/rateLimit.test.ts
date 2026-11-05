// Run with:  node --import tsx --test server/lib/rateLimit.test.ts
// The SQL itself (atomic under concurrency) is covered against a real Postgres
// in securityLimits.integration.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_DAILY, AI_HOURLY, AI_MAPPING_HOURLY, CODE_EMAIL_DAILY, CODE_GLOBAL_DAILY, CODE_EMAIL_HOURLY, CODE_IP_HOURLY,
  aiChecks, codeSendChecks, ipLimitId, rateLimitKey, takeRateLimit, windowStartOf,
  type RateLimitStore, type RateRule,
} from "./rateLimit.js";

const NEVER_CLEAN = () => 1;

function memoryStore() {
  const rows = new Map<string, { key: string; windowStart: Date; count: number }>();
  const deletes: Date[] = [];
  const id = (key: string, windowStart: Date) => `${key}|${windowStart.toISOString()}`;
  const store: RateLimitStore = {
    // Same contract as the SQL one: all counters move, or none.
    async takeAll(counters) {
      if (counters.some(c => (rows.get(id(c.key, c.windowStart))?.count ?? 0) >= c.limit)) return false;
      for (const { key, windowStart } of counters) {
        const row = rows.get(id(key, windowStart)) ?? { key, windowStart, count: 0 };
        row.count++;
        rows.set(id(key, windowStart), row);
      }
      return true;
    },
    async deleteOlderThan(before) {
      deletes.push(before);
      for (const [id, row] of rows) if (row.windowStart < before) rows.delete(id);
    },
  };
  return { store, rows, deletes };
}

const at = (iso: string) => new Date(iso);

test("windows are fixed and UTC-aligned", () => {
  assert.equal(windowStartOf(at("2026-11-04T10:59:59.999Z"), CODE_EMAIL_HOURLY.windowMs).toISOString(), "2026-11-04T10:00:00.000Z");
  assert.equal(windowStartOf(at("2026-11-04T23:30:00Z"), CODE_EMAIL_DAILY.windowMs).toISOString(), "2026-11-04T00:00:00.000Z");
});

test("the key never contains the email or IP, and differs per rule", () => {
  const key = rateLimitKey(CODE_EMAIL_HOURLY, "ana@example.com");
  assert.ok(key.startsWith("code-email-1h:"));
  assert.ok(!key.includes("ana"));
  assert.notEqual(key, rateLimitKey(CODE_EMAIL_DAILY, "ana@example.com"));
  assert.notEqual(key, rateLimitKey(CODE_EMAIL_HOURLY, "bea@example.com"));
});

test("the fourth code to one email in an hour is refused; the next hour allows again", async () => {
  const { store } = memoryStore();
  const send = (iso: string, email = "ana@example.com") =>
    takeRateLimit(store, codeSendChecks(email, "1.2.3.4"), at(iso), NEVER_CLEAN);
  assert.equal(await send("2026-11-04T10:00:00Z"), true);
  assert.equal(await send("2026-11-04T10:10:00Z"), true);
  assert.equal(await send("2026-11-04T10:20:00Z"), true);
  assert.equal(await send("2026-11-04T10:30:00Z"), false);
  assert.equal(await send("2026-11-04T10:31:00Z", "ANA@example.com "), false, "case and spaces don't make a new address");
  assert.equal(await send("2026-11-04T10:32:00Z", "bea@example.com"), true, "another address has its own count");
  assert.equal(await send("2026-11-04T11:00:00Z"), true);
});

test("one address gets at most 10 codes a day, however they are spread", async () => {
  const { store } = memoryStore();
  let sent = 0;
  for (let hour = 0; hour < 24; hour++) {
    for (let i = 0; i < 3; i++) {
      const hh = String(hour).padStart(2, "0");
      if (await takeRateLimit(store, codeSendChecks("ana@example.com", undefined), at(`2026-11-04T${hh}:0${i}:00Z`), NEVER_CLEAN)) sent++;
    }
  }
  assert.equal(sent, CODE_EMAIL_DAILY.limit);
  assert.equal(await takeRateLimit(store, codeSendChecks("ana@example.com", undefined), at("2026-11-05T00:00:00Z"), NEVER_CLEAN), true);
});

test("one IP can't cycle through many addresses", async () => {
  const { store } = memoryStore();
  let sent = 0;
  for (let i = 0; i < 30; i++) {
    if (await takeRateLimit(store, codeSendChecks(`user${i}@example.com`, "9.9.9.9"), at("2026-11-04T10:00:00Z"), NEVER_CLEAN)) sent++;
  }
  assert.equal(sent, CODE_IP_HOURLY.limit);
  assert.equal(await takeRateLimit(store, codeSendChecks("other@example.com", "8.8.8.8"), at("2026-11-04T10:00:00Z"), NEVER_CLEAN), true);
});

test("without an IP only the email rules apply", () => {
  assert.deepEqual(codeSendChecks("a@b.c", undefined).map(c => c.rule.name), ["code-global-1d", "code-email-1h", "code-email-1d"]);
  assert.equal(codeSendChecks("a@b.c", "1.1.1.1").length, 5);
});

test("a refused hit takes nothing: hammering in one hour can't lock the address out for the day", async () => {
  const { store, rows } = memoryStore();
  for (let i = 0; i < 100; i++) {
    await takeRateLimit(store, codeSendChecks("victim@example.com", `10.0.0.${i % 50}`), at("2026-11-04T10:00:00Z"), NEVER_CLEAN);
  }
  const daily = [...rows.values()].find(r => r.key === rateLimitKey(CODE_EMAIL_DAILY, "victim@example.com"));
  assert.equal(daily?.count, CODE_EMAIL_HOURLY.limit, "only the 3 sent codes count toward the day");
  assert.equal(await takeRateLimit(store, codeSendChecks("victim@example.com", "1.1.1.1"), at("2026-11-04T11:00:00Z"), NEVER_CLEAN), true);
});

test("a hit refused by one rule takes nothing from the others", async () => {
  const { store, rows } = memoryStore();
  for (let i = 0; i < CODE_IP_HOURLY.limit; i++) {
    await takeRateLimit(store, codeSendChecks(`user${i}@example.com`, "9.9.9.9"), at("2026-11-04T10:00:00Z"), NEVER_CLEAN);
  }
  assert.equal(await takeRateLimit(store, codeSendChecks("victim@example.com", "9.9.9.9"), at("2026-11-04T10:00:00Z"), NEVER_CLEAN), false);
  assert.ok(![...rows.values()].some(r => r.key === rateLimitKey(CODE_EMAIL_HOURLY, "victim@example.com")));
});

test("at most 80 codes a day for everyone, whatever the addresses and IPs", async () => {
  const { store } = memoryStore();
  let sent = 0;
  for (let i = 0; i < 120; i++) {
    const hh = String(Math.floor(i / 10)).padStart(2, "0");
    if (await takeRateLimit(store, codeSendChecks(`u${i}@example.com`, `10.0.${i}.1`), at(`2026-11-04T${hh}:00:00Z`), NEVER_CLEAN)) sent++;
  }
  assert.equal(sent, CODE_GLOBAL_DAILY.limit);
  assert.equal(await takeRateLimit(store, codeSendChecks("next@example.com", "10.9.9.9"), at("2026-11-05T00:00:00Z"), NEVER_CLEAN), true, "a new day");
});

test("IPv4 counts by address, IPv6 by its /64", () => {
  assert.equal(ipLimitId("203.0.113.7"), "203.0.113.7");
  assert.equal(ipLimitId("::ffff:203.0.113.7"), "203.0.113.7", "IPv4-mapped is the IPv4");
  assert.equal(ipLimitId("::FFFF:203.0.113.7"), "203.0.113.7");
  assert.equal(ipLimitId("2001:db8:85a3:1234:aaaa:bbbb:cccc:dddd"), "2001:db8:85a3:1234::/64");
  assert.equal(ipLimitId("2001:0db8:85a3:1234::1"), "2001:db8:85a3:1234::/64", "leading zeros and :: compression");
  assert.equal(ipLimitId("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipLimitId("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(ipLimitId("::1"), "0:0:0:0::/64");
  assert.equal(ipLimitId("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(ipLimitId("64:ff9b::192.0.2.33"), "64:ff9b:0:0::/64", "embedded IPv4 in the low bits");
  assert.equal(ipLimitId("::1.2.3.4"), "0:0:0:0::/64");
  assert.equal(ipLimitId("not-an-ip"), "not-an-ip");
});

test("addresses in one IPv6 /64 share the IP limit", async () => {
  const { store } = memoryStore();
  let sent = 0;
  for (let i = 0; i < 30; i++) {
    if (await takeRateLimit(store, codeSendChecks(`u${i}@example.com`, `2001:db8:1:2::${(i + 1).toString(16)}`), at("2026-11-04T10:00:00Z"), NEVER_CLEAN)) sent++;
  }
  assert.equal(sent, CODE_IP_HOURLY.limit);
});

test("the AI budget is 30 calls an hour per person, shared by the endpoints", async () => {
  const { store } = memoryStore();
  const now = at("2026-11-04T10:00:00Z");
  let ok = 0;
  for (let i = 0; i < AI_HOURLY.limit; i++) if (await takeRateLimit(store, aiChecks("u1"), now, NEVER_CLEAN)) ok++;
  assert.equal(ok, 30);
  assert.equal(await takeRateLimit(store, aiChecks("u1"), now, NEVER_CLEAN), false, "the 31st call in the hour");
  assert.equal(await takeRateLimit(store, aiChecks("u1", [AI_MAPPING_HOURLY]), now, NEVER_CLEAN), false, "mapping shares it");
  assert.equal(await takeRateLimit(store, aiChecks("u2"), now, NEVER_CLEAN), true, "per person");
});

test("the AI budget is 100 calls a day per person", async () => {
  const { store } = memoryStore();
  let ok = 0;
  for (let hour = 0; hour < 24; hour++) {
    for (let i = 0; i < 10; i++) {
      if (await takeRateLimit(store, aiChecks("u1"), at(`2026-11-04T${String(hour).padStart(2, "0")}:00:00Z`), NEVER_CLEAN)) ok++;
    }
  }
  assert.equal(ok, AI_DAILY.limit);
});

test("suggest-mapping keeps its own 10 an hour", async () => {
  const { store } = memoryStore();
  const now = at("2026-11-04T10:00:00Z");
  let ok = 0;
  for (let i = 0; i < 12; i++) if (await takeRateLimit(store, aiChecks("u1", [AI_MAPPING_HOURLY]), now, NEVER_CLEAN)) ok++;
  assert.equal(ok, 10);
  assert.equal(await takeRateLimit(store, aiChecks("u1"), now, NEVER_CLEAN), true, "classify still has budget left");
});

test("now and then a hit deletes windows older than two days; a failed cleanup doesn't fail the hit", async () => {
  const { store, rows, deletes } = memoryStore();
  const rule: RateRule = { name: "t", limit: 5, windowMs: 60 * 60 * 1000 };
  await takeRateLimit(store, [{ rule, id: "x" }], at("2026-11-01T10:00:00Z"), NEVER_CLEAN);
  await takeRateLimit(store, [{ rule, id: "x" }], at("2026-11-04T10:00:00Z"), () => 0);
  assert.deepEqual(deletes.map(d => d.toISOString()), ["2026-11-02T10:00:00.000Z"]);
  assert.equal(rows.size, 1);

  const failing: RateLimitStore = { ...store, deleteOlderThan: async () => { throw new Error("db down"); } };
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    assert.equal(await takeRateLimit(failing, [{ rule, id: "x" }], at("2026-11-04T10:00:00Z"), () => 0), true);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});
