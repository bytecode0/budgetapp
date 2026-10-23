import type { Sender } from "./types.js";

const BARE_ADDRESS = /^[^\s<>@]+@[^\s<>@]+$/;
const NAMED_ADDRESS = /^(.*?)\s*<([^\s<>@]+@[^\s<>@]+)>$/;

/** Parses EMAIL_FROM: "address@domain" or "Name <address@domain>" (name may be quoted). */
export function parseSender(raw: string): Sender {
  const value = raw.trim();
  if (BARE_ADDRESS.test(value)) return { address: value };
  const match = NAMED_ADDRESS.exec(value);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/, "$1").trim();
    return name ? { address: match[2], name } : { address: match[2] };
  }
  throw new Error('[email] EMAIL_FROM must be "address@domain" or "Name <address@domain>"');
}

/** Reads a required variable at call time; the error names the variable, never its value. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[email] ${name} is not set; cannot send email`);
  return value;
}
