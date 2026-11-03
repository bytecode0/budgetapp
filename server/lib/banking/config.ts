// Bank connection switch (docs/plan-deudas-y-onboarding.md §5.7). Read at call
// time, never at import: banking is ON only when every variable below is set;
// any one missing turns it off (GET /api/banking/status says so and every
// other banking route answers 503). There is no fallback value for any of them.
//
//   ENABLE_BANKING_APP_ID       application id (the JWT `kid`)
//   ENABLE_BANKING_PRIVATE_KEY  the application's PEM private key (RS256); literal
//                               "\n" escapes are accepted for one-line env vars
//   BANKING_CALLBACK_URL        our /api/banking/callback, exactly as registered
//                               at Enable Banking
//   ENCRYPTION_KEY              encrypts the stored provider session id
//   CRON_SECRET                 the daily sync (GET /api/banking/cron)
//
// Restricted mode: while the Enable Banking application only works for its
// owner's own accounts, BANKING_ALLOWED_EMAILS (comma-separated) says who may
// see or use banking. Unset or empty = nobody.

export interface BankingConfig {
  appId: string;
  privateKey: string;
  callbackUrl: string;
}

const env = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

/** One-line env vars often carry the PEM with literal "\n": restore them. */
export function normalizePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/** The provider configuration, or null when banking is off. */
export function bankingConfig(): BankingConfig | null {
  const appId = env("ENABLE_BANKING_APP_ID");
  const key = env("ENABLE_BANKING_PRIVATE_KEY");
  const callbackUrl = env("BANKING_CALLBACK_URL");
  if (!appId || !key || !callbackUrl || !env("ENCRYPTION_KEY") || !env("CRON_SECRET")) return null;
  return { appId, privateKey: normalizePem(key), callbackUrl };
}

export function bankingConfigured(): boolean {
  return bankingConfig() !== null;
}

/** BANKING_ALLOWED_EMAILS, lower-cased. Empty when unset: nobody is allowed. */
export function allowedBankingEmails(): Set<string> {
  return new Set((process.env.BANKING_ALLOWED_EMAILS ?? "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean));
}

export function bankingAllowedFor(email: string | null | undefined): boolean {
  return !!email && allowedBankingEmails().has(email.trim().toLowerCase());
}

/** Why a user can't use banking. Premium later: add "premium_required" here
 *  (decided below from the user's plan) and one strip state in the app (an
 *  upsell); /status passes the reason through and the UI branches on it. */
export type BankingAccessReason = "not_configured" | "not_allowed";
export type BankingAccess = { enabled: true } | { enabled: false; reason: BankingAccessReason };

/** THE access decision for banking, used by GET /api/banking/status and by
 *  every guarded route (requireBanking): configured, and the user allowed. */
export function bankingAccess(user: { email: string | null | undefined }): BankingAccess {
  if (!bankingConfigured()) return { enabled: false, reason: "not_configured" };
  if (!bankingAllowedFor(user.email)) return { enabled: false, reason: "not_allowed" };
  return { enabled: true };
}
