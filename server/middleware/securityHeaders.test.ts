// Run with:  node --import tsx --test server/middleware/securityHeaders.test.ts
//
// The API's headers (securityHeaders.ts), and the frontend's in vercel.json.
// The frontend CSP allows the one inline script of index.html (the theme
// paint before the app loads) by its sha256, not with 'unsafe-inline': if that
// script changes and the hash isn't updated, the browser silently skips it.
// This test makes that a CI failure instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Request, Response } from "express";
import { API_SECURITY_HEADERS, securityHeaders } from "./securityHeaders.js";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("the API middleware sets every header and calls next", () => {
  const set: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { set[k] = v; } } as unknown as Response;
  let nexted = false;
  securityHeaders({} as Request, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.deepEqual(set, { ...API_SECURITY_HEADERS });
  assert.equal(set["X-Frame-Options"], "DENY");
  assert.equal(set["X-Content-Type-Options"], "nosniff");
  assert.match(set["Strict-Transport-Security"], /^max-age=\d+; includeSubDomains$/);
  assert.match(set["Content-Security-Policy"], /frame-ancestors 'none'/);
});

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
const vercel = JSON.parse(read("vercel.json")) as { headers: HeaderRule[] };
const pageRule = vercel.headers.find(h => h.source === "/((?!api/).*)");
const header = (key: string) => pageRule?.headers.find(h => h.key === key)?.value;
// The page CSP ships report-only first (violations show in the console, nothing
// is blocked); switch the key to Content-Security-Policy once checked in the browser.
const pageCsp = () => header("Content-Security-Policy") ?? header("Content-Security-Policy-Report-Only");

test("vercel.json sets the security headers on every page", () => {
  assert.ok(pageRule, "a header rule for every non-API path");
  assert.equal(header("Strict-Transport-Security"), "max-age=63072000; includeSubDomains");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.ok(header("Permissions-Policy"));
  const csp = pageCsp() ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.doesNotMatch(csp.match(/script-src [^;]*/)?.[0] ?? "", /'unsafe-inline'|'unsafe-eval'/);
  // The manifest keeps its own rule.
  assert.ok(vercel.headers.some(h => h.source === "/manifest.webmanifest"));
});

test("the CSP script hashes match index.html's inline scripts exactly", () => {
  const html = read("index.html");
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(inline.length > 0, "index.html has its theme script");
  const expected = inline.map(body => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`).sort();
  const scriptSrc = (pageCsp() ?? "").match(/script-src ([^;]*)/)?.[1] ?? "";
  const allowed = scriptSrc.split(/\s+/).filter(s => s.startsWith("'sha256-")).sort();
  assert.deepEqual(allowed, expected,
    "update the sha256 in vercel.json's script-src to the one above (index.html's inline script changed)");
});
