// Run with:  node --import tsx --test server/lib/googleSignIn.test.ts
// Against a real Postgres (the password really stops working):
// securityLimits.integration.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { googleSignIn } from "./googleSignIn.js";

type Row = { id: string; email: string; name: string | null; emailVerified: Date | null; passwordHash: string | null; image?: string | null };

/** Just enough of prisma.user for googleSignIn, over one in-memory table. */
function fakeDb(rows: Row[]) {
  const calls: string[] = [];
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
  const user = {
    async findUnique({ where }: { where: { email: string } }) {
      calls.push("findUnique");
      return rows.find(r => r.email === where.email) ?? null;
    },
    async upsert({ where, update, create }: { where: { email: string }; update: Partial<Row>; create: Omit<Row, "id" | "passwordHash" | "emailVerified"> & Partial<Row> }) {
      calls.push("upsert");
      const row = rows.find(r => r.email === where.email);
      if (row) return Object.assign(row, update);
      const created = { passwordHash: null, emailVerified: null, ...create, id: `u${rows.length + 1}` };
      rows.push(created);
      return created;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) {
      calls.push("updateMany");
      const hit = rows.filter(r => matches(r, where));
      hit.forEach(r => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  return { db: { user } as unknown as Parameters<typeof googleSignIn>[0], calls };
}

const NOW = new Date("2026-11-04T10:00:00Z");

test("Google saying the email isn't verified (or not saying) signs nobody in and touches nothing", async () => {
  const rows: Row[] = [{ id: "u1", email: "ana@example.com", name: "Ana", emailVerified: NOW, passwordHash: "h" }];
  for (const verified_email of [false, undefined]) {
    const { db, calls } = fakeDb(rows);
    assert.deepEqual(await googleSignIn(db, { email: "ana@example.com", verified_email }, NOW), { error: "unverified" });
    assert.deepEqual(calls, []);
  }
});

test("no email from Google is its own error", async () => {
  const { db } = fakeDb([]);
  assert.deepEqual(await googleSignIn(db, { verified_email: true }), { error: "no_email" });
});

test("an account nobody verified loses the password and name someone set on it, and is claimed", async () => {
  const rows: Row[] = [{ id: "u1", email: "ana@example.com", name: "Attacker", emailVerified: null, passwordHash: "attacker-hash" }];
  const { db } = fakeDb(rows);
  const result = await googleSignIn(db, { email: "ana@example.com", name: "Ana", verified_email: true, picture: "p" }, NOW);
  assert.deepEqual(result, { userId: "u1", email: "ana@example.com", name: "Ana", isNewUser: false, claimed: true });
  assert.equal(rows[0].passwordHash, null);
  assert.equal(rows[0].name, "Ana");
  assert.equal(rows[0].emailVerified, NOW);
});

test("a verified account keeps its password and its verification date", async () => {
  const verifiedAt = new Date("2026-01-01T00:00:00Z");
  const rows: Row[] = [{ id: "u1", email: "ana@example.com", name: "Ana", emailVerified: verifiedAt, passwordHash: "own-hash" }];
  const { db } = fakeDb(rows);
  const result = await googleSignIn(db, { email: "ana@example.com", name: "Google Name", verified_email: true }, NOW);
  assert.ok("userId" in result && !result.claimed && !result.isNewUser);
  assert.equal(rows[0].name, "Ana", "a verified account keeps its name");
  assert.equal(rows[0].passwordHash, "own-hash");
  assert.equal(rows[0].emailVerified, verifiedAt);
});

test("a new email becomes a verified account with no password", async () => {
  const rows: Row[] = [];
  const { db } = fakeDb(rows);
  const result = await googleSignIn(db, { email: "new@example.com", name: "New", verified_email: true }, NOW);
  assert.ok("userId" in result && result.isNewUser && !result.claimed);
  assert.equal(rows[0].emailVerified, NOW);
  assert.equal(rows[0].passwordHash, null);
});
