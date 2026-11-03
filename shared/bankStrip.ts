// What banking shows outside Accounts (Activity's strip, Home's notice) and the
// order of the review flow. Pure: the app renders the result.

const DAY_MS = 86_400_000;
/** The in-app warning shows this many days before the consent lapses
 *  (the email goes out at 7: server/lib/banking/cron.ts). */
export const EXPIRY_WARNING_DAYS = 14;

export interface StripAccount { id: string; name: string; bankReviewedAt: string | null; bankPendingReview: number }
export interface StripConnection {
  id: string;
  institutionName: string;
  status: "pending" | "active" | "expired" | "error";
  isOwner: boolean;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  accounts: StripAccount[];
}

/** The /api/banking/status answer as the app holds it. "check_failed": the
 *  status couldn't be read (network, 5xx) — not the same as "not available". */
export type BankAvailability = "loading" | "available" | "unavailable" | "check_failed";

/** How the app reads a /api/banking/status answer. `status`: the HTTP status
 *  of a failed call, absent on a network failure. A failure is "couldn't
 *  check" (a retry) only for someone this browser saw eligible before: a
 *  transient 5xx must not show banking to someone off the allow-list. */
export function statusAvailability(
  res: { ok: true; enabled: boolean } | { ok: false; status?: number },
  knownEligible: boolean,
): Exclude<BankAvailability, "loading"> {
  if (res.ok) return res.enabled ? "available" : "unavailable";
  if (res.status !== undefined && res.status < 500) return "unavailable"; // an answer (e.g. signed out)
  return knownEligible ? "check_failed" : "unavailable";
}

export interface BankReviewTarget { connectionId: string; accountId: string; accountName: string; firstTime: boolean }

export type BankStrip =
  | { kind: "none" }
  | { kind: "check_failed" }
  | { kind: "connect" }
  | { kind: "reconnect"; connection: StripConnection; expired: boolean; daysLeft: number }
  | { kind: "pending"; count: number; bank: string | null; targets: BankReviewTarget[] }
  | { kind: "status"; connections: StripConnection[] };

/** Calendar days from today to the expiry day, in the user's local time:
 *  0 = it lapses today, 1 = tomorrow. (Rounded: a DST day is 23 or 25 h.) */
export function daysLeft(expiresAt: string, now: Date): number {
  const localDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((localDay(new Date(expiresAt)) - localDay(now)) / DAY_MS);
}

/** The consent no longer works: marked expired, or still "active" but past its
 *  expiry (the daily job hasn't caught up yet). */
export function consentExpired(c: Pick<StripConnection, "status" | "expiresAt">, now: Date): boolean {
  if (c.status === "expired") return true;
  return c.status === "active" && c.expiresAt !== null && new Date(c.expiresAt).getTime() <= now.getTime();
}

/** Consent lapsed, or lapsing within EXPIRY_WARNING_DAYS. */
export function needsReconnect(c: Pick<StripConnection, "status" | "expiresAt">, now: Date): boolean {
  if (consentExpired(c, now)) return true;
  return c.status === "active" && c.expiresAt !== null && daysLeft(c.expiresAt, now) <= EXPIRY_WARNING_DAYS;
}

/** The caller's reviews, in the order the flow walks them: first-time reviews
 *  first, then accounts with movements held back. Only the owner reviews, and
 *  never on an expired consent (the preview needs it). */
export function reviewQueue(connections: StripConnection[], now: Date): BankReviewTarget[] {
  const reviewable = connections.filter(c => c.isOwner && (c.status === "active" || c.status === "error") && !consentExpired(c, now));
  const target = (c: StripConnection, a: StripAccount): BankReviewTarget =>
    ({ connectionId: c.id, accountId: a.id, accountName: a.name, firstTime: !a.bankReviewedAt });
  return [
    ...reviewable.flatMap(c => c.accounts.filter(a => !a.bankReviewedAt).map(a => target(c, a))),
    ...reviewable.flatMap(c => c.accounts.filter(a => a.bankReviewedAt && a.bankPendingReview > 0).map(a => target(c, a))),
  ];
}

/** What waits for the caller's review: the flow's queue, the movements held
 *  back, and the bank's name when they're all from one. Owner-only (a
 *  partner's view has no pending counts: server/lib/banking/prompt.ts). */
export function pendingReviews(connections: StripConnection[], now: Date): { targets: BankReviewTarget[]; count: number; bank: string | null } {
  const owned = connections.filter(c => c.isOwner);
  const targets = reviewQueue(owned, now);
  // Counted over the same accounts the flow will open: an expired consent's
  // held rows can't be reviewed, so they aren't announced.
  const accountOf = (t: BankReviewTarget) => owned.find(c => c.id === t.connectionId)!.accounts.find(a => a.id === t.accountId)!;
  const banks = new Set(targets.map(t => owned.find(c => c.id === t.connectionId)!.institutionName));
  const count = targets.reduce((s, t) => s + accountOf(t).bankPendingReview, 0);
  return { targets, count, bank: banks.size === 1 ? [...banks][0] : null };
}

/** Activity's strip. Priority: a consent to renew, then movements to review,
 *  then the quiet status line; the "connect" invitation only when the person
 *  owns no connection, banking is available to them and they haven't closed
 *  it. A partner never gets the owner's reconnect or reviews (they can't act
 *  on them), only the status line. */
export function bankStrip(input: {
  availability: BankAvailability;
  promptDismissed: boolean;
  connections: StripConnection[];
  now: Date;
}): BankStrip {
  const { availability, promptDismissed, connections, now } = input;
  if (availability === "check_failed") return { kind: "check_failed" };
  if (availability !== "available") return { kind: "none" };

  const visible = connections.filter(c => c.status !== "pending" || c.isOwner);
  const owned = visible.filter(c => c.isOwner);

  const renew = owned.find(c => needsReconnect(c, now));
  if (renew) {
    return { kind: "reconnect", connection: renew, expired: consentExpired(renew, now), daysLeft: renew.expiresAt ? Math.max(daysLeft(renew.expiresAt, now), 0) : 0 };
  }

  const pending = pendingReviews(owned, now);
  if (pending.targets.length > 0) return { kind: "pending", ...pending };

  if (owned.length === 0 && !promptDismissed) return { kind: "connect" };

  const synced = visible.filter(c => c.status === "active" || c.status === "error");
  return synced.length > 0 ? { kind: "status", connections: synced } : { kind: "none" };
}

/** "3 h ago" as Intl.RelativeTimeFormat wants it (a negative value). */
export function sinceParts(iso: string, now: Date): { value: number; unit: "minute" | "hour" | "day" } {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return { value: -minutes, unit: "minute" };
  if (minutes < 48 * 60) return { value: -Math.floor(minutes / 60), unit: "hour" };
  return { value: -Math.floor(minutes / (24 * 60)), unit: "day" };
}
