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

export interface BankReviewTarget { connectionId: string; accountId: string; accountName: string; firstTime: boolean }

export type BankStrip =
  | { kind: "none" }
  | { kind: "check_failed" }
  | { kind: "connect" }
  | { kind: "reconnect"; connection: StripConnection; expired: boolean; daysLeft: number }
  | { kind: "pending"; count: number; bank: string | null; targets: BankReviewTarget[] }
  | { kind: "status"; connections: StripConnection[] };

export function daysLeft(expiresAt: string, now: Date): number {
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
}

/** Consent lapsed, or lapsing within EXPIRY_WARNING_DAYS. */
export function needsReconnect(c: Pick<StripConnection, "status" | "expiresAt">, now: Date): boolean {
  if (c.status === "expired") return true;
  return c.status === "active" && c.expiresAt !== null && daysLeft(c.expiresAt, now) <= EXPIRY_WARNING_DAYS;
}

/** The caller's reviews, in the order the flow walks them: first-time reviews
 *  first, then accounts with movements held back. Only the owner reviews, and
 *  never on an expired consent (the preview needs it). */
export function reviewQueue(connections: StripConnection[]): BankReviewTarget[] {
  const reviewable = connections.filter(c => c.isOwner && (c.status === "active" || c.status === "error"));
  const target = (c: StripConnection, a: StripAccount): BankReviewTarget =>
    ({ connectionId: c.id, accountId: a.id, accountName: a.name, firstTime: !a.bankReviewedAt });
  return [
    ...reviewable.flatMap(c => c.accounts.filter(a => !a.bankReviewedAt).map(a => target(c, a))),
    ...reviewable.flatMap(c => c.accounts.filter(a => a.bankReviewedAt && a.bankPendingReview > 0).map(a => target(c, a))),
  ];
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
    return { kind: "reconnect", connection: renew, expired: renew.status === "expired", daysLeft: renew.expiresAt ? Math.max(daysLeft(renew.expiresAt, now), 0) : 0 };
  }

  const targets = reviewQueue(owned);
  if (targets.length > 0) {
    const banks = new Set(targets.map(t => owned.find(c => c.id === t.connectionId)!.institutionName));
    const count = owned.flatMap(c => c.accounts).reduce((s, a) => s + a.bankPendingReview, 0);
    return { kind: "pending", count, bank: banks.size === 1 ? [...banks][0] : null, targets };
  }

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
