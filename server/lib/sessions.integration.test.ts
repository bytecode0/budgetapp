// LPBETA-21 and LPBETA-23 (items 2, 5 and 6) against a REAL Postgres, through
// the real routes: revocable sessions (password reset, "sign out on every
// device"), the single-use Google exchange token, a sign-up and a login lock
// that answer the same whether or not the email has an account, and emails
// trimmed + lowercased everywhere. Opt-in: skipped unless TEST_DATABASE_URL is
// set (see server/lib/ingest/import.integration.test.ts for the setup). Every
// table is TRUNCATEd, so the host must be localhost.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("sessions and account emails (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let hashOtp: typeof import("./otp.js").hashOtp;
  let auth: typeof import("../routes/auth.js");
  let throttle: typeof import("./loginThrottle.js");
  let checkEmailDuplicates: typeof import("../scripts/checkEmailDuplicates.js").checkEmailDuplicates;
  let server: Server;
  let base: string;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);

    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "integration-test-secret";
    process.env.NODE_ENV = "test";
    process.env.EMAIL_PROVIDER = "console";
    process.env.EMAIL_FROM = "LifePlan <test@example.com>";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    ({ hashOtp } = await import("./otp.js"));
    auth = await import("../routes/auth.js");
    throttle = await import("./loginThrottle.js");
    ({ checkEmailDuplicates } = await import("../scripts/checkEmailDuplicates.js"));
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.some(t => t.tablename === "User"), "schema not pushed to the test database");
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'tokenVersion'`;
    assert.equal(cols.length, 1, "User.tokenVersion missing: run prisma db push on the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"public"."${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()));
    await prisma?.$disconnect();
  });

  // Every request comes from the same IP: each test starts with fresh counters.
  beforeEach(async () => {
    await prisma.rateLimitHit.deleteMany({});
  });

  // Everything printed (the console transport's emails) goes here, off the test output.
  const printed: string[] = [];
  const realLog = console.log;
  before(() => { console.log = (...args: unknown[]) => { printed.push(args.map(String).join(" ")); }; });
  after(() => { console.log = realLog; });

  /** The emails the console transport "sent" while `fn` ran. */
  async function captureEmails<T>(fn: () => Promise<T>): Promise<{ result: T; emails: { to: string; subject: string; body: string }[] }> {
    const from = printed.length;
    const result = await fn();
    const emails = printed.slice(from).filter(l => l.includes("[email:console]")).map(l => ({
      to: /^To:\s+(.*)$/m.exec(l)?.[1] ?? "",
      subject: /^Subject:\s+(.*)$/m.exec(l)?.[1] ?? "",
      body: l,
    }));
    return { result, emails };
  }

  type Res = { status: number; body: Record<string, unknown>; cookie: string | null; cleared: boolean };
  async function call(method: string, path: string, body?: unknown, cookie?: string | null): Promise<Res> {
    const result = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie && { cookie: `token=${cookie}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const set = result.headers.getSetCookie().find(c => c.startsWith("token="));
    const value = set ? set.slice("token=".length).split(";")[0] : null;
    return {
      status: result.status,
      body: await result.json() as Record<string, unknown>,
      cookie: value || null,
      cleared: !!set && !value,
    };
  }
  const post = (path: string, body?: unknown, cookie?: string | null) => call("POST", path, body ?? {}, cookie);
  const get = (path: string, cookie?: string | null) => call("GET", path, undefined, cookie);
  /** A requireAuth route plus /me: both must agree on whether the session is alive. */
  async function alive(cookie: string | null): Promise<[number, number]> {
    return [(await get("/api/allocations", cookie)).status, (await get("/api/auth/me", cookie)).status];
  }

  async function verifiedUser(email: string, password: string, extra: Record<string, unknown> = {}) {
    return prisma.user.create({
      data: { email, name: "Test", emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 4), ...extra },
    });
  }
  async function login(email: string, password: string): Promise<string> {
    const r = await post("/api/auth/login", { email, password });
    assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`);
    assert.ok(r.cookie);
    return r.cookie!;
  }

  // ── LPBETA-21 ────────────────────────────────────────────────────────

  it("a password reset ends every session; the new password's session works", async () => {
    const email = "reset-sessions@test.local";
    const user = await verifiedUser(email, "old-password");
    const phone = await login(email, "old-password");
    const legacy = signToken({ userId: user.id }); // a cookie from before tokenVersion existed
    assert.deepEqual(await alive(phone), [200, 200]);
    assert.deepEqual(await alive(legacy), [200, 200], "a cookie without a version counts as version 0");

    await prisma.otpToken.create({ data: { email, type: "password_reset", tokenHash: hashOtp("135790"), expiresAt: new Date(Date.now() + 60_000) } });
    const verified = await post("/api/auth/verify-reset-otp", { email, otp: "135790" });
    assert.equal(verified.status, 200);
    const reset = await post("/api/auth/reset-password", { resetToken: verified.body.resetToken, newPassword: "new-password" }, phone);
    assert.equal(reset.status, 200);
    assert.ok(reset.cleared, "the reset clears this browser's (dead) cookie");
    assert.equal(reset.cookie, null, "and doesn't sign in: the screen sends them to the login");

    assert.deepEqual(await alive(phone), [401, 401], "the old session is over");
    assert.deepEqual(await alive(legacy), [401, 401], "so is a cookie from before the version");
    assert.equal((await post("/api/auth/login", { email, password: "old-password" })).status, 401);
    const fresh = await login(email, "new-password");
    assert.deepEqual(await alive(fresh), [200, 200]);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion, 1);
  });

  it("sign out on every device: every other session ends and this one keeps going", async () => {
    const email = "close-all@test.local";
    await verifiedUser(email, "password-123");
    const laptop = await login(email, "password-123");
    const lostPhone = await login(email, "password-123");

    assert.equal((await post("/api/auth/logout-all", {})).status, 401, "needs a session");
    const r = await post("/api/auth/logout-all", {}, laptop);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { data: { ok: true } });
    assert.ok(r.cookie, "this device gets a fresh cookie");

    assert.deepEqual(await alive(r.cookie), [200, 200], "this device stays signed in");
    assert.deepEqual(await alive(lostPhone), [401, 401], "the lost phone is out");
    assert.deepEqual(await alive(laptop), [401, 401], "and so is the cookie it replaced");

    // Twice in a row: the second one ends the first one's fresh cookie too, except on the device that pressed.
    const again = await post("/api/auth/logout-all", {}, r.cookie);
    assert.equal(again.status, 200);
    assert.deepEqual(await alive(r.cookie), [401, 401]);
    assert.deepEqual(await alive(again.cookie), [200, 200]);
  });

  // ── LPBETA-23 item 2 ─────────────────────────────────────────────────

  it("the Google exchange token works once, even when the URL is reused or raced", async () => {
    const user = await verifiedUser("google-once@test.local", "irrelevant-1");
    const token = await auth.issueGoogleSession(prisma, user.id, "Google-Once@Test.local");
    const first = await post("/api/auth/google/exchange", { token });
    assert.equal(first.status, 200);
    assert.deepEqual(await alive(first.cookie), [200, 200]);
    const second = await post("/api/auth/google/exchange", { token });
    assert.equal(second.status, 400, "a copied URL is dead once used");
    assert.equal(second.cookie, null);

    const raced = await auth.issueGoogleSession(prisma, user.id, user.email!);
    const results = await Promise.all(Array.from({ length: 5 }, () => post("/api/auth/google/exchange", { token: raced })));
    assert.equal(results.filter(r => r.status === 200).length, 1, "exactly one parallel exchange wins");

    // Past its 2 minutes the row no longer counts (the JWT would also be expired).
    const late = await auth.issueGoogleSession(prisma, user.id, user.email!);
    await prisma.otpToken.updateMany({ where: { type: "google_exchange" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await post("/api/auth/google/exchange", { token: late })).status, 400);
    // A new one sweeps the expired rows.
    await auth.issueGoogleSession(prisma, user.id, user.email!);
    assert.equal(await prisma.otpToken.count({ where: { type: "google_exchange" } }), 1);

    // A token signed without a row (e.g. before this deploy) doesn't work.
    assert.equal((await post("/api/auth/google/exchange", { token: auth.signGoogleSession(user.id, "never-stored") })).status, 400);
  });

  // ── LPBETA-23 item 5 ─────────────────────────────────────────────────

  it("register answers the same for a new email and a verified account; the owner gets 'you already have an account'", async () => {
    const owner = await verifiedUser("owner@test.local", "owner-pass-1", { name: "Olga", settings: { create: { monthlyIncome: 0, language: "en" } } });
    const fresh = await captureEmails(() => post("/api/auth/register", { name: "New", email: "brand-new@test.local", password: "password123" }));
    const taken = await captureEmails(() => post("/api/auth/register", { name: "Intruder", email: "owner@test.local", password: "intruder-pass" }));

    assert.equal(taken.result.status, fresh.result.status);
    assert.deepEqual(taken.result.body, fresh.result.body, "identical body");
    assert.equal(taken.result.status, 200);
    assert.equal(fresh.emails.length, 1);
    assert.match(fresh.emails[0].body, /\d{6}/, "a new account gets a code");
    assert.equal(taken.emails.length, 1);
    assert.equal(taken.emails[0].to, "owner@test.local");
    assert.match(taken.emails[0].subject, /already have/, "in the account's language");
    assert.doesNotMatch(taken.emails[0].body, /Intruder/, "never the name the sign-up typed");
    assert.equal(await prisma.otpToken.count({ where: { email: "owner@test.local" } }), 0, "no code for the existing account");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    assert.equal(after.name, "Olga");
    assert.ok(await bcrypt.compare("owner-pass-1", after.passwordHash!), "the password is untouched");
    assert.equal((await post("/api/auth/login", { email: "owner@test.local", password: "intruder-pass" })).status, 401);

    // The same limits: the 4th in an hour is a 429 for an existing account, as for a new one.
    for (let i = 0; i < 2; i++) assert.equal((await post("/api/auth/register", { name: "I", email: "owner@test.local", password: "intruder-pass" })).status, 200);
    const limited = await captureEmails(() => post("/api/auth/register", { name: "I", email: "owner@test.local", password: "intruder-pass" }));
    assert.equal(limited.result.status, 429);
    assert.equal(limited.result.body.code, "rate_limited");
    assert.equal(limited.emails.length, 0, "nothing sent over the limit");
  });

  it("the login lock answers the same for an email with no account", async () => {
    await verifiedUser("locked-real@test.local", "right-password");
    const attempt = (email: string) => post("/api/auth/login", { email, password: "wrong-password" });
    const sequence = async (email: string) => {
      const out: { status: number; body: Record<string, unknown> }[] = [];
      for (let i = 0; i < throttle.LOGIN_MAX_FAILURES + 2; i++) {
        const r = await attempt(email);
        out.push({ status: r.status, body: r.body });
      }
      return out;
    };
    const real = await sequence("locked-real@test.local");
    const ghost = await sequence("nobody-here@test.local");
    assert.deepEqual(ghost, real, "same statuses and bodies, try by try");
    assert.deepEqual(real.map(r => r.status), [...Array(throttle.LOGIN_MAX_FAILURES).fill(401), 429, 429]);

    // Even the right password is refused while locked.
    assert.equal((await post("/api/auth/login", { email: "locked-real@test.local", password: "right-password" })).status, 429);

    // Both locks run out after the same time, and the count starts over.
    await prisma.user.updateMany({ where: { email: "locked-real@test.local" }, data: { loginLockedUntil: new Date(Date.now() - 1000) } });
    await prisma.$executeRaw`UPDATE "RateLimitHit" SET "windowStart" = "windowStart" - interval '16 minutes' WHERE "key" = ${throttle.unknownLoginKey("nobody-here@test.local")}`;
    assert.equal((await attempt("locked-real@test.local")).status, 401);
    assert.equal((await attempt("nobody-here@test.local")).status, 401);

    // Parallel tries on an unknown email are counted one by one: exactly MAX get through.
    const statuses = await Promise.all(Array.from({ length: 15 }, () =>
      throttle.reserveUnknownLoginAttempt(prisma, "burst@test.local")));
    assert.equal(statuses.filter(s => s === "ok").length, throttle.LOGIN_MAX_FAILURES);
  });

  it("an account with no password (Google only) locks like any other", async () => {
    await prisma.user.create({ data: { email: "google-only@test.local", emailVerified: new Date() } });
    const statuses: number[] = [];
    for (let i = 0; i < throttle.LOGIN_MAX_FAILURES + 1; i++) {
      statuses.push((await post("/api/auth/login", { email: "google-only@test.local", password: "guess-123" })).status);
    }
    assert.deepEqual(statuses, [...Array(throttle.LOGIN_MAX_FAILURES).fill(401), 429]);
  });

  // ── LPBETA-23 item 6 ─────────────────────────────────────────────────

  it("emails are trimmed and lowercased at register, verify, login and reset", async () => {
    const { emails } = await captureEmails(() => post("/api/auth/register", { name: "Ana", email: "  Ana.Mixed@Test.Local ", password: "password123" }));
    const stored = await prisma.user.findMany({ where: { email: { contains: "mixed", mode: "insensitive" } } });
    assert.deepEqual(stored.map(u => u.email), ["ana.mixed@test.local"]);
    assert.equal(emails[0].to, "ana.mixed@test.local");
    const token = await prisma.otpToken.findFirstOrThrow({ where: { email: "ana.mixed@test.local", type: "email_verification" } });
    const otp = [...new Set(emails[0].body.match(/\d{6}/g) ?? [])].find(c => hashOtp(c) === token.tokenHash);
    assert.ok(otp);

    // A second sign-up with other capitals is the same account, not a new one.
    assert.equal((await post("/api/auth/register", { name: "Ana", email: "ANA.MIXED@test.local", password: "password123" })).status, 200);
    assert.equal(await prisma.user.count({ where: { email: { contains: "mixed", mode: "insensitive" } } }), 1);

    const latest = await prisma.otpToken.findFirstOrThrow({ where: { email: "ana.mixed@test.local", type: "email_verification" } });
    await prisma.otpToken.update({ where: { id: latest.id }, data: { tokenHash: hashOtp("112233") } });
    const verified = await post("/api/auth/verify-email", { email: "Ana.MIXED@test.local ", otp: "112233", password: "password123", name: "Ana" });
    assert.equal(verified.status, 200);
    assert.equal((await post("/api/auth/login", { email: " ANA.mixed@TEST.local", password: "password123" })).status, 200);

    const reset = await captureEmails(() => post("/api/auth/send-reset", { email: "ANA.MIXED@TEST.LOCAL" }));
    assert.equal(reset.emails.length, 1);
    assert.equal(await prisma.otpToken.count({ where: { email: "ana.mixed@test.local", type: "password_reset" } }), 1);
  });

  it("an account stored with capitals is found; colliding accounts resolve to the verified, then oldest", async () => {
    await verifiedUser("Legacy.Caps@Test.Local", "legacy-pass-1");
    assert.equal((await post("/api/auth/login", { email: "legacy.caps@test.local", password: "legacy-pass-1" })).status, 200);

    // An unverified duplicate, older, and a verified one: the verified wins.
    await prisma.user.create({ data: { email: "dup@test.local", passwordHash: await bcrypt.hash("unverified-pass", 4), createdAt: new Date("2026-01-01") } });
    await verifiedUser("Dup@Test.Local", "verified-pass");
    assert.equal((await post("/api/auth/login", { email: "DUP@test.local", password: "verified-pass" })).status, 200);
    assert.equal((await post("/api/auth/login", { email: "dup@test.local", password: "unverified-pass" })).status, 401);
    // Register lands on the verified one too (account-exists email, no code).
    const reg = await captureEmails(() => post("/api/auth/register", { name: "X", email: "dup@test.local", password: "password123" }));
    assert.equal(reg.result.status, 200);
    assert.equal(reg.emails[0].to, "Dup@Test.Local");
    assert.match(reg.emails[0].subject, /Ya tienes una cuenta/);

    // Two verified: the one verified first.
    await verifiedUser("twin@test.local", "first-pass", { emailVerified: new Date("2026-02-01") });
    await verifiedUser("TWIN@test.local", "second-pass", { emailVerified: new Date("2026-03-01") });
    assert.equal((await post("/api/auth/login", { email: "Twin@test.local", password: "first-pass" })).status, 200);
    assert.equal((await post("/api/auth/login", { email: "twin@test.local", password: "second-pass" })).status, 401);

    // `_` and `%` are literal characters, not wildcards.
    await verifiedUser("under_score@test.local", "under-pass");
    assert.equal((await post("/api/auth/login", { email: "underXscore@test.local", password: "under-pass" })).status, 401);
    assert.equal((await post("/api/auth/login", { email: "under%@test.local", password: "under-pass" })).status, 401);
    assert.equal((await post("/api/auth/login", { email: "Under_Score@test.local", password: "under-pass" })).status, 200);

    // The check script counts them, and prints no address.
    const counts = await checkEmailDuplicates(prisma);
    assert.equal(counts.collidingAddresses, 2, "dup@ and twin@");
    assert.equal(counts.collidingAccounts, 4);
    assert.equal(counts.collidingVerified, 3);
    assert.ok(counts.notNormalised >= 3, "Legacy.Caps, Dup and TWIN");
    const { formatEmailDuplicates } = await import("../scripts/checkEmailDuplicates.js");
    assert.doesNotMatch(formatEmailDuplicates(counts), /@/);
  });

  it("Google, partner invites and account deletion use the normalised address", async () => {
    // Google: an account stored with capitals is the same account.
    const caps = await verifiedUser("G.Caps@Test.Local", "gcaps-pass");
    const { googleSignIn } = await import("./googleSignIn.js");
    const signIn = await googleSignIn(prisma, { email: " g.caps@TEST.local", verified_email: true });
    assert.ok("userId" in signIn && signIn.userId === caps.id && !signIn.isNewUser);

    // Partner invite to capitals, accepted by the lowercase account.
    const inviter = await verifiedUser("inviter@test.local", "inviter-pass");
    const partner = await verifiedUser("partner@test.local", "partner-pass");
    const invite = await post("/api/partner/invite", { email: "  Partner@Test.Local " }, signToken({ userId: inviter.id }));
    assert.equal(invite.status, 200);
    const row = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: inviter.id } });
    assert.equal(row.invitedEmail, "partner@test.local");
    assert.equal((await post("/api/partner/accept", { token: row.token }, signToken({ userId: partner.id }))).status, 200);

    // Account deletion: the code is keyed by the normalised address and works.
    const del = await verifiedUser("Del.Me@Test.Local", "del-pass");
    const cookie = signToken({ userId: del.id });
    assert.equal((await post("/api/account/deletion/code", {}, cookie)).status, 200);
    const code = await prisma.otpToken.findFirstOrThrow({ where: { type: "account_deletion" } });
    assert.equal(code.email, "del.me@test.local");
    await prisma.otpToken.update({ where: { id: code.id }, data: { tokenHash: hashOtp("998877") } });
    assert.equal((await post("/api/account/deletion", { code: "998877" }, cookie)).status, 200);

    // Deleting `a_b@` erases only its own invites and codes: `_` is not a wildcard.
    const sender = await verifiedUser("sender@test.local", "sender-pass");
    const expiresAt = new Date(Date.now() + 86_400_000);
    await prisma.partnerInvite.create({ data: { senderId: sender.id, invitedEmail: "a_b@test.local", token: "tok-ab", expiresAt } });
    await prisma.partnerInvite.create({ data: { senderId: sender.id, invitedEmail: "axb@test.local", token: "tok-axb", expiresAt } });
    await prisma.otpToken.create({ data: { email: "axb@test.local", type: "password_reset", tokenHash: "h", expiresAt } });
    const { eraseReferences } = await import("./accountDeletion.js");
    const gone = await verifiedUser("A_B@Test.Local", "ab-pass");
    await prisma.$transaction(tx => eraseReferences(tx, gone.id, gone.email));
    assert.deepEqual((await prisma.partnerInvite.findMany({ where: { senderId: sender.id } })).map(i => i.token), ["tok-axb"]);
    assert.equal(await prisma.otpToken.count({ where: { email: "axb@test.local" } }), 1);
  });
});
