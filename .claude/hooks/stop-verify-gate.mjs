#!/usr/bin/env node
// Stop hook. Hard gate: if code changed this turn (marked by post-edit-check.mjs),
// `npm run verify` must pass before the turn is allowed to end. Uses the
// JSON-decision channel (decision:"block") so this is enforced, not advisory.
import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MARKER = path.join(PROJECT_DIR, ".claude", ".verify-pending");

if (!existsSync(MARKER)) {
  process.exit(0);
}

try {
  execSync("npm run verify", { cwd: PROJECT_DIR, stdio: "pipe", timeout: 180_000 });
  unlinkSync(MARKER);
  process.exit(0);
} catch (err) {
  const output = (err.stdout?.toString() || "") + (err.stderr?.toString() || "") || err.message || "";
  const tail = output.slice(-4000);
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `\`npm run verify\` failed — fix it before finishing:\n\n${tail}`,
    })
  );
  process.exit(0);
}
