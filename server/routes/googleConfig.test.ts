import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

// Empty, not deleted: dotenv (loaded by server/app) never overrides a var that
// is already set, so a local .env can't sneak the values back in.
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.GOOGLE_CALLBACK_URL = "";
process.env.JWT_SECRET ??= "test-secret";

const { missingGoogleEnv } = await import("./auth.js");

const ALL_GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_CALLBACK_URL: "https://example.test/api/auth/google/callback",
};

test("missingGoogleEnv lists every unset Google var", () => {
  assert.deepEqual(missingGoogleEnv(ALL_GOOGLE_ENV), []);
  assert.deepEqual(missingGoogleEnv({ ...ALL_GOOGLE_ENV, GOOGLE_CALLBACK_URL: "" }), ["GOOGLE_CALLBACK_URL"]);
  assert.deepEqual(missingGoogleEnv({}), ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"]);
});

test("without Google config, sign-in answers 503 instead of redirecting to localhost", async () => {
  const { default: app } = await import("../app.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/google`, { redirect: "manual" });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Google sign-in is not configured" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
