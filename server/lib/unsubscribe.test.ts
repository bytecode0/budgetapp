// Run with:  node --import tsx --test server/lib/unsubscribe.test.ts
import { test, before } from "node:test";
import assert from "node:assert/strict";

before(() => { process.env.JWT_SECRET ??= "unit-test-secret"; });

test("a token verifies to the user it was signed for, and only that one", async () => {
  const { unsubscribeToken, verifyUnsubscribeToken } = await import("./unsubscribe.js");
  const token = unsubscribeToken("user_1");
  assert.equal(verifyUnsubscribeToken(token), "user_1");
  const [, mac] = token.split(".");
  assert.equal(verifyUnsubscribeToken(`${Buffer.from("user_2").toString("base64url")}.${mac}`), null, "another user's id with this signature");
  for (const bad of ["", "abc", `${token}.x`, token.slice(0, -2), 42, null, undefined]) {
    assert.equal(verifyUnsubscribeToken(bad), null, String(bad));
  }
});

test("a token is not a session: it isn't a JWT the session check would accept", async () => {
  const { unsubscribeToken } = await import("./unsubscribe.js");
  const { verifyToken } = await import("./jwt.js");
  assert.throws(() => verifyToken(unsubscribeToken("user_1")));
});

test("the link goes to the public page with the token and the language", async () => {
  const { unsubscribeUrl, verifyUnsubscribeToken } = await import("./unsubscribe.js");
  const url = new URL(unsubscribeUrl("https://app.example.com", "user_1", "en"));
  assert.equal(url.origin + url.pathname, "https://app.example.com/unsubscribe");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.equal(verifyUnsubscribeToken(url.searchParams.get("token")), "user_1");
});
