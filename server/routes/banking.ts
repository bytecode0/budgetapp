// Bank connection via Enable Banking (docs/plan-deudas-y-onboarding.md, epic 5).
//
// Every route but /status, /callback and /cron goes through requireAuth +
// requireBanking: 503 banking_disabled when the provider isn't configured,
// 403 banking_not_allowed when the user isn't on BANKING_ALLOWED_EMAILS
// (restricted mode). Connections follow the per-person ownership rules
// (server/lib/ownership.ts): req.userId is the pool, req.authUserId the real
// person; only a connection's owner links, reviews, syncs, reconnects or
// deletes it; a household member only sees the household-visible ones.
import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents } from "../lib/money.js";
import { encrypt, decrypt } from "../lib/crypto/secretBox.js";
import { mutationAccess, visibleToWhere } from "../lib/ownership.js";
import { ALLOCATION_NOT_FOUND, allocationsInPool } from "../lib/poolRefs.js";
import { parseLocale } from "../lib/email/locales/index.js";
import { confirmImport } from "../lib/ingest/confirm.js";
import { bankingAllowedFor, bankingConfig } from "../lib/banking/config.js";
import { getBankingClient, EnableBankingError } from "../lib/banking/enableBanking.js";
import {
  BANKING_STATE_COOKIE, BANKING_STATE_COOKIE_OPTS, BANKING_STATE_MAX_AGE_MS,
  createConnectState, createExchangeToken, newBankingNonce, readConnectState, readExchangeToken,
} from "../lib/banking/handoff.js";
import { applyLinks, planLinks, relinkByStableKey } from "../lib/banking/link.js";
import { PROVIDER, previewBankAccount, refreshBalance, reviewDateFrom, syncConnection, syncErrorCode } from "../lib/banking/sync.js";
import { cronAuthorized, runBankingCron } from "../lib/banking/cron.js";
import type { BankingProviderClient, BankProviderAccount } from "../lib/banking/types.js";

export const bankingRouter = Router();

const MAX_CONSENT_DAYS = 180;
const DAY_MS = 86_400_000;

const DISABLED = { error: "Bank connection is not enabled", code: "banking_disabled" };
const NOT_ALLOWED = { error: "Bank connection is not available for this account", code: "banking_not_allowed" };
const NOT_FOUND = { error: "Connection not found", code: "banking_not_found" };
const NOT_OWNER = { error: "Only the connection's owner can do this", code: "banking_not_owner" };
const EXPIRED = { error: "The bank consent has expired: reconnect", code: "banking_expired" };
const PROVIDER_FAILED = { error: "The bank provider failed", code: "banking_provider_failed" };

async function userEmail(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

interface BankingRequest extends AuthRequest { bankingClient?: BankingProviderClient }

/** Enforced on the SERVER for every banking route (the frontend also hides it). */
async function requireBanking(req: BankingRequest, res: Response, next: NextFunction) {
  try {
    const client = getBankingClient();
    if (!client) return res.status(503).json(DISABLED);
    if (!bankingAllowedFor(await userEmail(req.authUserId))) return res.status(403).json(NOT_ALLOWED);
    req.bankingClient = client;
    next();
  } catch (err) {
    console.error("[banking/access]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
}

const guarded = [requireAuth, requireBanking] as const;

/** A connection of the caller's pool they may act on as its owner. */
async function ownedConnection(req: AuthRequest, res: Response, id: string = req.params.id) {
  const connection = await prisma.bankConnection.findFirst({ where: { id, userId: req.userId! } });
  const access = connection ? mutationAccess(connection, req.authUserId) : "hidden";
  if (!connection || access === "hidden") { res.status(404).json(NOT_FOUND); return null; }
  if (access !== "ok") { res.status(403).json(NOT_OWNER); return null; }
  return connection;
}

/** A provider failure as an API answer: never the provider's text. */
function providerError(res: Response, where: string, err: unknown) {
  console.error(`[banking/${where}] ${syncErrorCode(err)}`);
  return res.status(502).json(PROVIDER_FAILED);
}

/** The bank accounts of a connection's consent, each with the local account
 *  linked to it, if any. Null when the consent is no longer authorised. */
async function bankAccountsOf(client: BankingProviderClient, connection: { id: string; requisitionId: string }) {
  if (!connection.requisitionId) return null;
  const session = await client.getSession(decrypt(connection.requisitionId));
  if (!session.authorized) return null;
  const accounts: BankProviderAccount[] = [];
  for (const id of session.accountIds) accounts.push(await client.getAccount(id));
  const linked = await prisma.account.findMany({
    where: { bankConnectionId: connection.id, externalAccountId: { in: accounts.map(a => a.id) } },
    select: { id: true, externalAccountId: true },
  });
  const byExternal = new Map(linked.map(a => [a.externalAccountId!, a.id]));
  return accounts.map(a => {
    const { stableKey: _key, ...shown } = a;
    return { ...shown, linkedAccountId: byExternal.get(a.id) ?? null };
  });
}

// GET /api/banking/status → { data: { enabled } }: whether THIS user can use
// bank connection (configured and, in restricted mode, on the allow-list).
bankingRouter.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const enabled = bankingConfig() !== null && bankingAllowedFor(await userEmail(req.authUserId));
    return res.json({ data: { enabled } });
  } catch (err) {
    console.error("[banking/status]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/banking/institutions?country=ES → { data: { institutions } }
bankingRouter.get("/institutions", ...guarded, async (req: BankingRequest, res: Response) => {
  const country = typeof req.query.country === "string" && /^[A-Z]{2}$/.test(req.query.country) ? req.query.country : "ES";
  try {
    const institutions = await req.bankingClient!.listInstitutions(country);
    return res.json({ data: { institutions: institutions.map(i => ({ name: i.name, country: i.country, logo: i.logo ?? null })) } });
  } catch (err) {
    return providerError(res, "institutions", err);
  }
});

// GET /api/banking/connections → { data: { connections } }: the caller's own
// plus household-visible ones; revoked ones are history, not shown.
bankingRouter.get("/connections", ...guarded, async (req: AuthRequest, res: Response) => {
  try {
    const connections = await prisma.bankConnection.findMany({
      where: { userId: req.userId!, status: { not: "revoked" }, ...visibleToWhere(req.authUserId!) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, institutionName: true, institutionCountry: true, status: true, ownerUserId: true,
        consentGivenAt: true, expiresAt: true, lastSyncedAt: true, lastSyncError: true,
        accounts: { select: { id: true, name: true, type: true, bankReviewedAt: true, bankPendingReview: true } },
        debts: { select: { id: true, name: true } },
      },
    });
    return res.json({ data: { connections: connections.map(c => ({ ...c, isOwner: c.ownerUserId === req.authUserId })) } });
  } catch (err) {
    console.error("[banking/connections]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connect { name, country, connectionId?, lang? } → { data: { url } }
// Starts (or renews) consent with a bank. Reuses the caller's existing
// connection to that bank, so reconnecting never duplicates it; while the user
// is at the bank an active connection keeps syncing with its old consent.
bankingRouter.post("/connect", ...guarded, async (req: BankingRequest, res: Response) => {
  try {
    const client = req.bankingClient!;
    const config = bankingConfig()!;
    const { name, country, connectionId, lang } = req.body as { name?: unknown; country?: unknown; connectionId?: unknown; lang?: unknown };

    let existing = null;
    if (typeof connectionId === "string" && connectionId) {
      existing = await ownedConnection(req, res, connectionId);
      if (!existing) return;
    }
    const bankName = existing?.institutionId ?? (typeof name === "string" ? name : "");
    const bankCountry = existing?.institutionCountry ?? (typeof country === "string" ? country : "ES");
    if (!bankName || !/^[A-Z]{2}$/.test(bankCountry)) return res.status(400).json({ error: "name and country are required", code: "banking_unknown_bank" });

    let institutions;
    try { institutions = await client.listInstitutions(bankCountry); } catch (err) { return providerError(res, "connect", err); }
    const institution = institutions.find(i => i.name === bankName);
    if (!institution) return res.status(400).json({ error: "Unknown bank", code: "banking_unknown_bank" });

    existing ??= await prisma.bankConnection.findFirst({
      where: { userId: req.userId!, ownerUserId: req.authUserId!, institutionId: institution.name, institutionCountry: institution.country },
      orderBy: { createdAt: "desc" },
    });
    const connection = existing ?? await prisma.bankConnection.create({
      data: {
        userId: req.userId!,
        ownerUserId: req.authUserId!,
        householdId: req.householdId ?? null,
        provider: PROVIDER,
        institutionId: institution.name,
        institutionName: institution.name,
        institutionCountry: institution.country,
        requisitionId: "", // the encrypted session id, once the user consents
        status: "pending",
      },
    });

    const nonce = newBankingNonce();
    const state = createConnectState({ connectionId: connection.id, userId: req.authUserId!, nonce });
    const days = Math.min(institution.maxConsentDays, MAX_CONSENT_DAYS);
    let url;
    try {
      ({ url } = await client.startAuthorization({
        institution: { name: institution.name, country: institution.country },
        state,
        redirectUrl: config.callbackUrl,
        validUntil: new Date(Date.now() + days * DAY_MS),
        language: parseLocale(lang) ?? undefined,
      }));
    } catch (err) {
      return providerError(res, "connect", err);
    }
    res.cookie(BANKING_STATE_COOKIE, nonce, { ...BANKING_STATE_COOKIE_OPTS, maxAge: BANKING_STATE_MAX_AGE_MS });
    return res.json({ data: { url } });
  } catch (err) {
    console.error("[banking/connect]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/banking/callback?code=…&state=… — the bank's redirect after
// consent. NOT authenticated: trusts only the signed `state`, bound to the
// nonce cookie set by /connect. Creates the session, stores its id
// encrypted, and hands the SPA a short-lived signed token (?bankToken=).
bankingRouter.get("/callback", async (req: Request, res: Response) => {
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const fail = (code: string) => res.redirect(`${appUrl}/?error=banking_${code}`);
  const cookieNonce = req.cookies?.[BANKING_STATE_COOKIE];
  res.clearCookie(BANKING_STATE_COOKIE, BANKING_STATE_COOKIE_OPTS);
  const { code, state, error } = req.query as Record<string, unknown>;

  const handoff = readConnectState(state, cookieNonce);
  if (!handoff) return fail("invalid_state");
  try {
    const client = getBankingClient();
    if (!client) return fail("disabled");
    const connection = await prisma.bankConnection.findFirst({ where: { id: handoff.connectionId, ownerUserId: handoff.userId } });
    if (!connection) return fail("not_found");
    if (!bankingAllowedFor(await userEmail(handoff.userId))) return fail("not_allowed");

    if (error !== undefined || typeof code !== "string" || !code) {
      // Never consented before: nothing to keep.
      if (!connection.requisitionId && connection.status === "pending") {
        await prisma.bankConnection.delete({ where: { id: connection.id } });
      }
      return fail("denied");
    }

    const session = await client.createSession(code);
    const previous = connection.requisitionId ? decrypt(connection.requisitionId) : null;
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: {
        provider: PROVIDER,
        requisitionId: encrypt(session.sessionId),
        status: "active",
        consentGivenAt: new Date(),
        expiresAt: session.validUntil,
        expiryWarnedAt: null,
        lastSyncError: null,
      },
    });
    // A renewed consent hands out new account ids: re-point what was linked.
    await relinkByStableKey(connection.id, session.accounts);
    if (previous && previous !== session.sessionId) {
      await client.deleteSession(previous).catch(err => console.error(`[banking/callback] old session not revoked: ${syncErrorCode(err)}`));
    }
    return res.redirect(`${appUrl}/?bankToken=${encodeURIComponent(createExchangeToken(handoff))}`);
  } catch (err) {
    console.error(`[banking/callback] ${syncErrorCode(err)}`);
    return fail("failed");
  }
});

// POST /api/banking/exchange { token } → { data: { connectionId, institutionName, accounts } }
// Resolves the post-consent hand-off for the mapping step. The token must
// belong to the logged-in user, and the connection to them.
bankingRouter.post("/exchange", ...guarded, async (req: BankingRequest, res: Response) => {
  const handoff = readExchangeToken((req.body as { token?: unknown })?.token);
  if (!handoff || handoff.userId !== req.authUserId) return res.status(400).json({ error: "Invalid or expired token", code: "banking_invalid_token" });
  try {
    const connection = await ownedConnection(req, res, handoff.connectionId);
    if (!connection) return;
    let accounts;
    try { accounts = await bankAccountsOf(req.bankingClient!, connection); } catch (err) { return providerError(res, "exchange", err); }
    if (!accounts) return res.status(409).json(EXPIRED);
    return res.json({ data: { connectionId: connection.id, institutionName: connection.institutionName, accounts } });
  } catch (err) {
    console.error("[banking/exchange]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/banking/connections/:id/bank-accounts → { data: { accounts } }
// The same list as /exchange, to (re)open the mapping step later.
bankingRouter.get("/connections/:id/bank-accounts", ...guarded, async (req: BankingRequest, res: Response) => {
  try {
    const connection = await ownedConnection(req, res);
    if (!connection) return;
    let accounts;
    try { accounts = await bankAccountsOf(req.bankingClient!, connection); } catch (err) { return providerError(res, "bank-accounts", err); }
    if (!accounts) return res.status(409).json(EXPIRED);
    return res.json({ data: { connectionId: connection.id, institutionName: connection.institutionName, accounts } });
  } catch (err) {
    console.error("[banking/bank-accounts]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connections/:id/link-accounts
// { mappings: [{ externalAccountId, accountId? | create?: { name, type } }] } → { data: { linked } }
// Only to accounts the caller owns; a bank card links to a card account and
// its debt (created when missing). Nothing is imported yet: the first sync of
// each account waits for the user's review.
bankingRouter.post("/connections/:id/link-accounts", ...guarded, async (req: BankingRequest, res: Response) => {
  try {
    const connection = await ownedConnection(req, res);
    if (!connection) return;
    if (connection.status !== "active") return res.status(409).json(EXPIRED);
    const client = req.bankingClient!;
    let bankAccounts;
    try { bankAccounts = await bankAccountsOf(client, connection); } catch (err) { return providerError(res, "link-accounts", err); }
    if (!bankAccounts) return res.status(409).json(EXPIRED);
    const local = await prisma.account.findMany({
      where: { userId: req.userId! },
      select: { id: true, userId: true, ownerUserId: true, visibility: true, type: true, isArchived: true },
    });
    const plan = planLinks((req.body as { mappings?: unknown })?.mappings, bankAccounts, local, { userId: req.userId!, authUserId: req.authUserId! });
    if ("error" in plan) {
      const { status, ...body } = plan;
      return res.status(status).json(body);
    }
    const fallbackName = connection.institutionName;
    let linked;
    try {
      linked = await applyLinks(client, { userId: req.userId!, authUserId: req.authUserId!, householdId: req.householdId, connectionId: connection.id }, plan.actions, fallbackName);
    } catch (err) {
      if (err instanceof EnableBankingError) return providerError(res, "link-accounts", err);
      throw err;
    }
    return res.json({ data: { linked: linked.length, accountIds: linked } });
  } catch (err) {
    console.error("[banking/link-accounts]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

async function linkedAccount(req: AuthRequest, res: Response, connectionId: string, accountId: unknown) {
  const account = typeof accountId === "string" && accountId
    ? await prisma.account.findFirst({
      where: { id: accountId, userId: req.userId!, ownerUserId: req.authUserId!, bankConnectionId: connectionId, externalAccountId: { not: null } },
      select: { id: true, type: true, externalAccountId: true, bankReviewedAt: true },
    })
    : null;
  if (!account) res.status(400).json({ error: "Account is not linked to this connection", code: "banking_account_not_linked" });
  return account;
}

// GET /api/banking/connections/:id/preview?accountId=… → { data: ImportPreview }
// The review step, in the import wizard's preview shape: the first time, the
// last 90 days; then everything since the last review (movements the daily
// sync held back included). Nothing is written.
bankingRouter.get("/connections/:id/preview", ...guarded, async (req: BankingRequest, res: Response) => {
  try {
    const connection = await ownedConnection(req, res);
    if (!connection) return;
    if (connection.status !== "active" && connection.status !== "error") return res.status(409).json(EXPIRED);
    const account = await linkedAccount(req, res, connection.id, req.query.accountId);
    if (!account) return;
    let preview;
    try {
      preview = await previewBankAccount(req.bankingClient!, connection, account, reviewDateFrom(account, new Date()));
    } catch (err) {
      if (err instanceof EnableBankingError) return providerError(res, "preview", err);
      throw err;
    }
    // NOTE: amounts in `preview` are already euros — do not run serializeMoney.
    return res.json({ data: { ...preview, accountId: account.id } });
  } catch (err) {
    console.error("[banking/preview]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connections/:id/confirm { accountId, rows } → { data: { inserted, summary } }
// The rows the user kept in the review, written exactly like a file import
// (confirmImport) with source "bank_sync". From now on the daily sync writes
// this account's clean movements on its own.
bankingRouter.post("/connections/:id/confirm", ...guarded, async (req: BankingRequest, res: Response) => {
  try {
    const connection = await ownedConnection(req, res);
    if (!connection) return;
    const { accountId, rows } = req.body as {
      accountId?: unknown;
      rows?: { kind: string; externalId: string; date: string; description?: string; merchant?: string; amount: number; allocationId?: string | null; debtId?: string | null }[];
    };
    const account = await linkedAccount(req, res, connection.id, accountId);
    if (!account) return;
    // An empty list is a valid review: nothing kept.
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows are required", code: "invalid_rows" });
    const namedLines = rows.filter(r => r && (r.kind === "expense" || r.kind === "refund")).map(r => r.allocationId);
    if (!(await allocationsInPool(req.userId!, namedLines))) return res.status(404).json(ALLOCATION_NOT_FOUND);

    let result: Awaited<ReturnType<typeof confirmImport>> = { expenses: 0, income: 0, inserted: 0, summary: { expenses: 0, refunds: 0, incomes: 0, payments: [] } };
    if (rows.length > 0) {
      result = await confirmImport(
        { userId: req.userId!, authUserId: req.authUserId!, householdId: req.householdId, accountId: account.id, source: "bank_sync" },
        rows.map(r => ({ ...r, amountCents: toCents(r.amount) })),
      );
      if ("error" in result) {
        const { status, ...body } = result;
        return res.status(status).json(body);
      }
    }
    await prisma.account.update({ where: { id: account.id }, data: { bankReviewedAt: new Date(), bankPendingReview: 0 } });
    // Nothing waits for review now: the balance (a card's debt) can follow the bank.
    try {
      await refreshBalance(req.bankingClient!, connection, account);
    } catch (err) {
      console.error(`[banking/confirm] balance not refreshed: ${syncErrorCode(err)}`);
    }
    return res.json({ data: { inserted: result.inserted, summary: result.summary } });
  } catch (err) {
    console.error("[banking/confirm]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connections/:id/sync → { data: SyncResult } — "sync now".
// Writes only clean movements of reviewed accounts, like the daily sync.
bankingRouter.post("/connections/:id/sync", ...guarded, async (req: BankingRequest, res: Response) => {
  try {
    const connection = await ownedConnection(req, res);
    if (!connection) return;
    const result = await syncConnection(req.bankingClient!, connection.id);
    // NOTE: every field is a row count, not money: no serializeMoney here.
    if (!result.ok) {
      if (result.error === "expired" || result.error === "not_active") return res.status(409).json(EXPIRED);
      return res.status(502).json({ ...PROVIDER_FAILED, code: "banking_sync_failed" });
    }
    return res.json({ data: result });
  } catch (err) {
    console.error("[banking/sync]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/banking/connections/:id — revokes the consent at the provider
// (best effort), stops syncing and unlinks the accounts. Movements already
// imported stay: they're the user's.
bankingRouter.delete("/connections/:id", ...guarded, async (req: BankingRequest, res: Response) => {
  try {
    const connection = await ownedConnection(req, res);
    if (!connection) return;
    if (connection.requisitionId) {
      try {
        await req.bankingClient!.deleteSession(decrypt(connection.requisitionId));
      } catch (err) {
        console.error(`[banking/delete] provider session not revoked: ${syncErrorCode(err)}`);
      }
    }
    await prisma.$transaction([
      prisma.account.updateMany({
        where: { bankConnectionId: connection.id },
        data: { bankConnectionId: null, externalAccountId: null, externalAccountKey: null, balanceSource: "manual", bankReviewedAt: null, bankPendingReview: 0 },
      }),
      prisma.debt.updateMany({
        where: { bankConnectionId: connection.id },
        data: { bankConnectionId: null, externalAccountId: null, balanceSource: "manual" },
      }),
      prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: "revoked", requisitionId: "", expiresAt: null, expiryWarnedAt: null, lastSyncError: null },
      }),
    ]);
    return res.json({ data: { revoked: true } });
  } catch (err) {
    console.error("[banking/delete]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/banking/cron — Vercel Cron, daily (vercel.json). Authenticated by
// "Authorization: Bearer $CRON_SECRET", not by a user session.
bankingRouter.get("/cron", async (req: Request, res: Response) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "Not authorized" });
  const client = getBankingClient();
  if (!client) return res.status(503).json(DISABLED);
  try {
    const summary = await runBankingCron(client);
    return res.json({ data: summary });
  } catch (err) {
    console.error("[banking/cron]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});
