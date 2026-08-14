#!/usr/bin/env node
// PostToolUse hook (matcher: Edit|Write). Reads the tool-call JSON from stdin,
// type-checks the touched file's project immediately, and keeps en/es locale
// keys in sync — fast feedback within the same turn, before the Stop gate
// re-verifies everything end to end.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, utimesSync, closeSync, openSync } from "node:fs";
import path from "node:path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MARKER = path.join(PROJECT_DIR, ".claude", ".verify-pending");

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function touchMarker() {
  const fd = openSync(MARKER, "a");
  closeSync(fd);
  utimesSync(MARKER, new Date(), new Date());
}

function runTsc(project) {
  try {
    execSync(`npx tsc --noEmit -p ${project}`, { cwd: PROJECT_DIR, stdio: "pipe" });
    return null;
  } catch (err) {
    return (err.stdout?.toString() || err.message || "").trim();
  }
}

function checkLocalesInSync() {
  const enPath = path.join(PROJECT_DIR, "src/locales/en.json");
  const esPath = path.join(PROJECT_DIR, "src/locales/es.json");
  if (!existsSync(enPath) || !existsSync(esPath)) return null;

  const flatten = (obj, prefix = "") =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? flatten(v, prefix ? `${prefix}.${k}` : k)
        : [prefix ? `${prefix}.${k}` : k]
    );

  const en = new Set(flatten(JSON.parse(readFileSync(enPath, "utf8"))));
  const es = new Set(flatten(JSON.parse(readFileSync(esPath, "utf8"))));
  const missingInEs = [...en].filter((k) => !es.has(k));
  const missingInEn = [...es].filter((k) => !en.has(k));
  if (missingInEs.length === 0 && missingInEn.length === 0) return null;

  const lines = [];
  if (missingInEs.length) lines.push(`Missing in es.json: ${missingInEs.join(", ")}`);
  if (missingInEn.length) lines.push(`Missing in en.json: ${missingInEn.join(", ")}`);
  return lines.join("\n");
}

const input = readStdin();
const filePath = input?.tool_input?.file_path;
if (!filePath) process.exit(0);

const rel = path.relative(PROJECT_DIR, filePath);

const isRelevant =
  rel.startsWith("server" + path.sep) ||
  rel.startsWith("src" + path.sep) ||
  rel === "prisma/schema.prisma" ||
  rel === "package.json";
if (isRelevant) touchMarker();

let error = null;

if (rel.startsWith("server" + path.sep) && rel.endsWith(".ts")) {
  error = runTsc("tsconfig.server.json");
} else if (rel.startsWith("src" + path.sep) && /\.(ts|tsx)$/.test(rel)) {
  error = runTsc("tsconfig.json");
} else if (rel === "src/locales/en.json" || rel === "src/locales/es.json") {
  error = checkLocalesInSync();
}

if (error) {
  console.error(error);
  process.exit(2);
}
process.exit(0);
