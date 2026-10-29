// Run with:  node --import tsx --test server/lib/rateLimit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "./rateLimit.js";

test("allows `limit` hits per key per window, then refuses until the window slides", () => {
  const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(rl.take("a", 0), true);
  assert.equal(rl.take("a", 10), true);
  assert.equal(rl.take("a", 20), false);
  assert.equal(rl.take("b", 20), true, "keys are independent");
  assert.equal(rl.take("a", 1000), true, "the first hit left the window");
  assert.equal(rl.take("a", 1005), false);
});
