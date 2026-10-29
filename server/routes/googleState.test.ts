// Run with:  node --import tsx --test server/routes/googleState.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { OAuth2Client } from "google-auth-library";

// Dummy values: enough to build the Google URL, never used to reach Google
// (getToken is stubbed below). Set before the app loads; dotenv never
// overrides a variable that is already set.
process.env.GOOGLE_CLIENT_ID = "dummy-client-id";
process.env.GOOGLE_CLIENT_SECRET = "dummy-client-secret";
process.env.GOOGLE_CALLBACK_URL = "https://example.test/api/auth/google/callback";
process.env.APP_URL = "https://app.example.test";
process.env.JWT_SECRET ??= "test-secret";

const {
  GOOGLE_STATE_COOKIE, newGoogleNonce, buildGoogleState, parseGoogleState, googleNonceMatches,
} = await import("./auth.js");

// Records whether the callback got as far as exchanging the code.
let tokenExchanges = 0;
OAuth2Client.prototype.getToken = (async () => {
  tokenExchanges++;
  throw new Error("stubbed: no network in tests");
}) as typeof OAuth2Client.prototype.getToken;

let server: Server;
let base = "";

before(async () => {
  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const FAILED = "https://app.example.test/?error=google_failed";

/** The `name=value` of the state cookie in a response, and its attributes. */
function stateCookie(res: Response): { value: string; attrs: string } | null {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${GOOGLE_STATE_COOKIE}=`));
  if (!raw) return null;
  const [pair, ...attrs] = raw.split(";");
  return { value: decodeURIComponent(pair.slice(GOOGLE_STATE_COOKIE.length + 1)), attrs: attrs.join(";") };
}

async function callback(query: Record<string, string>, cookieNonce?: string) {
  return fetch(`${base}/api/auth/google/callback?${new URLSearchParams(query)}`, {
    redirect: "manual",
    headers: cookieNonce !== undefined ? { cookie: `${GOOGLE_STATE_COOKIE}=${cookieNonce}` } : {},
  });
}

test("nonce: 32 random bytes in base64url, different every time", () => {
  const a = newGoogleNonce();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, newGoogleNonce());
});

test("state round-trips the nonce and a valid language; anything else is rejected or dropped", () => {
  const nonce = newGoogleNonce();
  assert.deepEqual(parseGoogleState(buildGoogleState(nonce, "en")), { nonce, lang: "en" });
  assert.deepEqual(parseGoogleState(buildGoogleState(nonce, null)), { nonce, lang: null });
  assert.deepEqual(parseGoogleState(`${nonce}.fr`), { nonce, lang: null });
  assert.equal(parseGoogleState("es"), null); // the old state: language only
  assert.equal(parseGoogleState(""), null);
  assert.equal(parseGoogleState(undefined), null);
  assert.equal(parseGoogleState(["a", "b"]), null);
  assert.equal(parseGoogleState(`${nonce}x.es`), null);
});

test("nonce comparison: equal only for the same string", () => {
  const nonce = newGoogleNonce();
  assert.equal(googleNonceMatches(nonce, nonce), true);
  assert.equal(googleNonceMatches(newGoogleNonce(), nonce), false);
  assert.equal(googleNonceMatches(nonce.slice(1), nonce), false);
  assert.equal(googleNonceMatches(undefined, nonce), false);
});

test("GET /api/auth/google sets the state cookie and sends its nonce in Google's state", async () => {
  const res = await fetch(`${base}/api/auth/google?lang=en`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const cookie = stateCookie(res);
  assert.ok(cookie, "state cookie not set");
  assert.match(cookie.attrs, /HttpOnly/i);
  assert.match(cookie.attrs, /SameSite=Lax/i);
  assert.match(cookie.attrs, /Path=\/api\/auth\/google(;|$)/i);
  assert.match(cookie.attrs, /Max-Age=600/i);

  const google = new URL(res.headers.get("location")!);
  assert.equal(google.hostname, "accounts.google.com");
  assert.deepEqual(parseGoogleState(google.searchParams.get("state")), { nonce: cookie.value, lang: "en" });
});

test("callback without the state cookie redirects to google_failed and never exchanges the code", async () => {
  tokenExchanges = 0;
  const res = await callback({ code: "a-code", state: buildGoogleState(newGoogleNonce(), "es") });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), FAILED);
  assert.equal(tokenExchanges, 0);
});

test("callback with a cookie that doesn't match state redirects to google_failed, clears it, never exchanges", async () => {
  tokenExchanges = 0;
  const res = await callback({ code: "a-code", state: buildGoogleState(newGoogleNonce(), "es") }, newGoogleNonce());
  assert.equal(res.headers.get("location"), FAILED);
  assert.equal(tokenExchanges, 0);
  assert.equal(stateCookie(res)?.value, "", "state cookie not cleared");
});

test("callback with a malformed state redirects to google_failed and never exchanges", async () => {
  tokenExchanges = 0;
  const nonce = newGoogleNonce();
  const res = await callback({ code: "a-code", state: "es" }, nonce);
  assert.equal(res.headers.get("location"), FAILED);
  assert.equal(tokenExchanges, 0);
});

test("callback with the matching cookie goes on to exchange the code, and clears the cookie", async () => {
  tokenExchanges = 0;
  const nonce = newGoogleNonce();
  const res = await callback({ code: "a-code", state: buildGoogleState(nonce, "es") }, nonce);
  assert.equal(tokenExchanges, 1);
  assert.equal(res.headers.get("location"), FAILED); // the stubbed exchange throws
  assert.equal(stateCookie(res)?.value, "", "state cookie not cleared");
});

test("callback when the user denied access clears the cookie too", async () => {
  const nonce = newGoogleNonce();
  const res = await callback({ error: "access_denied", state: buildGoogleState(nonce, "es") }, nonce);
  assert.equal(res.headers.get("location"), "https://app.example.test/?error=google_denied");
  assert.equal(stateCookie(res)?.value, "", "state cookie not cleared");
});
