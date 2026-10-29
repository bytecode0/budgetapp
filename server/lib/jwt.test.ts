import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const JWT_MODULE = fileURLToPath(new URL("./jwt.ts", import.meta.url));

// Loads jwt.ts in a fresh process: the check runs once, at import.
function loadJwt(secret: string | undefined) {
  const env = { ...process.env };
  if (secret === undefined) delete env.JWT_SECRET;
  else env.JWT_SECRET = secret;
  return spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(JWT_MODULE)})`], {
    env,
    encoding: "utf8",
  });
}

test("jwt refuses to load without JWT_SECRET instead of using a public default", () => {
  for (const secret of [undefined, ""]) {
    const result = loadJwt(secret);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JWT_SECRET is not set/);
  }
});

test("jwt loads with JWT_SECRET set", () => {
  const result = loadJwt("test-secret");
  assert.equal(result.status, 0, result.stderr);
});
