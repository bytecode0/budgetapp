import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { signToken, verifyToken } from "../lib/jwt.js";
import { getBankingClient, bankingEnabled } from "../lib/banking/gocardless.js";
import { buildPreviewFromProviderTxns, writeSyncedRows, syncConnection } from "../lib/banking/sync.js";

export const bankingRouter = Router();

const CALLBACK_URL =
  process.env.GOCARDLESS_REDIRECT_URL ?? "http://localhost:3002/api/banking/callback";

// One-time exchange tokens for the post-consent hand-off, exactly mirroring
// googleSessions in server/routes/auth.ts — the callback is a top-level
// browser redirect from the bank, so the SPA needs a way to pick up the
// result without the opaque token round-tripping through the URL twice.
const bankingSessions = new Map<string, { connectionId: string; expiresAt: number }>();
function createBankingSession(connectionId: string): string {
  const token = crypto.randomUUID();
  bankingSessions.set(token, { connectionId, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

// GET /api/banking/status — whether Open Banking is configured at all, so the
// frontend can hide "Connect your bank" entirely when it isn't (mirrors /api/ai/status).
bankingRouter.get("/status", (_req: Request, res: Response) => {
  res.json({ enabled: bankingEnabled() });
});

// GET /api/banking/institutions?country=ES
bankingRouter.get("/institutions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const client = getBankingClient();
    if (!client) return res.status(503).json({ error: "Open Banking is not configured" });

    const country = typeof req.query.country === "string" ? req.query.country : "ES";
    const institutions = await client.listInstitutions(country);
    return res.json({ institutions });
  } catch (err) {
    console.error("[banking/institutions]", err);
    return res.status(500).json({ error: "Failed to list institutions" });
  }
});

// GET /api/banking/connections — the user's bank connections + status.
bankingRouter.get("/connections", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const connections = await prisma.bankConnection.findMany({
      where: { userId: req.userId!, OR: [{ ownerUserId: req.authUserId! }, { visibility: "household" }] },
      orderBy: { createdAt: "desc" },
      include: { accounts: { select: { id: true, name: true } }, debts: { select: { id: true, name: true } } },
    });
    return res.json({ connections });
  } catch (err) {
    console.error("[banking/connections]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connect  { institutionId, institutionName }
// Creates a pending BankConnection + a GoCardless requisition, returns the
// bank's consent redirect URL for the frontend to navigate to.
bankingRouter.post("/connect", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const client = getBankingClient();
    if (!client) return res.status(503).json({ error: "Open Banking is not configured" });

    const { institutionId, institutionName } = req.body as { institutionId?: string; institutionName?: string };
    if (!institutionId || !institutionName) {
      return res.status(400).json({ error: "institutionId and institutionName are required" });
    }

    // Reconnecting the same institution reuses its existing row instead of
    // creating a duplicate (Phase 5) — an active connection is left alone
    // (its accounts/debts stay linked to it); only a lapsed one is recycled.
    const existing = await prisma.bankConnection.findFirst({
      where: { userId: req.userId!, institutionId, status: { not: "active" } },
    });

    // Create the connection row first (status: pending) so its id can be
    // embedded in our own signed state — avoids depending on the provider
    // echoing anything back through the redirect besides our own query string.
    const connection = existing
      ? await prisma.bankConnection.update({
          where: { id: existing.id },
          data: { status: "pending", institutionName, requisitionId: "", lastSyncError: null },
        })
      : await prisma.bankConnection.create({
          data: {
            userId: req.userId!,
            ownerUserId: req.authUserId!,
            householdId: req.householdId ?? null,
            institutionId,
            institutionName,
            requisitionId: "", // filled in below once the provider returns one
            status: "pending",
          },
        });

    // Short-lived, single-purpose token — this is the CSRF `state` param the
    // existing Google OAuth flow (server/routes/auth.ts) is missing.
    const state = signToken({ purpose: "banking_connect", connectionId: connection.id }, "10m");
    const redirectUrl = `${CALLBACK_URL}?state=${encodeURIComponent(state)}`;

    const result = await client.createConnection(institutionId, redirectUrl, connection.id);

    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { requisitionId: result.requisitionId },
    });

    return res.json({ redirectUrl: result.redirectUrl });
  } catch (err) {
    console.error("[banking/connect]", err);
    return res.status(500).json({ error: "Failed to start bank connection" });
  }
});

// GET /api/banking/callback — hit by the bank's redirect after consent, NOT
// authenticated (a top-level cross-site navigation can't reliably carry our
// cookie). The signed `state` param is the only thing this route trusts.
bankingRouter.get("/callback", async (req: Request, res: Response) => {
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const { state } = req.query as Record<string, string>;

  if (!state) return res.redirect(`${appUrl}/?error=banking_denied`);

  try {
    const payload = verifyToken(state);
    if (payload.purpose !== "banking_connect" || !payload.connectionId) {
      throw new Error("Invalid state payload");
    }

    const connection = await prisma.bankConnection.findUnique({ where: { id: payload.connectionId } });
    if (!connection) return res.redirect(`${appUrl}/?error=banking_not_found`);

    const client = getBankingClient();
    if (!client) return res.redirect(`${appUrl}/?error=banking_disabled`);

    const accountsResult = await client.getConnectionAccounts(connection.requisitionId);
    if (!accountsResult.linked) {
      await prisma.bankConnection.update({ where: { id: connection.id }, data: { status: "error", lastSyncError: `Provider status: ${accountsResult.status}` } });
      return res.redirect(`${appUrl}/?error=banking_not_linked`);
    }

    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "active", consentGivenAt: new Date(), lastSyncError: null },
    });

    const sessionToken = createBankingSession(connection.id);
    return res.redirect(`${appUrl}/?bankToken=${sessionToken}`);
  } catch (err) {
    console.error("[banking/callback]", err);
    return res.redirect(`${appUrl}/?error=banking_failed`);
  }
});

// POST /api/banking/exchange  { token }
// Mirrors /auth/google/exchange — resolves the opaque token from the redirect
// hand-off and returns the connection's accounts for the mapping step.
bankingRouter.post("/exchange", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "Token is required" });

  const session = bankingSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    bankingSessions.delete(token);
    return res.status(400).json({ error: "Invalid or expired session token" });
  }
  bankingSessions.delete(token);

  try {
    const connection = await prisma.bankConnection.findUnique({ where: { id: session.connectionId } });
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const client = getBankingClient();
    if (!client) return res.status(503).json({ error: "Open Banking is not configured" });

    const accountsResult = await client.getConnectionAccounts(connection.requisitionId);

    return res.json({
      connectionId: connection.id,
      institutionName: connection.institutionName,
      accounts: accountsResult.accounts,
    });
  } catch (err) {
    console.error("[banking/exchange]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connections/:id/link-accounts
// body: { mappings: [{ externalAccountId, accountId?, create?: { name, type } }] }
// Either attaches a provider account to an existing local Account, or creates one.
bankingRouter.post("/connections/:id/link-accounts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const connection = await prisma.bankConnection.findFirst({ where: { id, userId: req.userId! } });
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const { mappings } = req.body as {
      mappings: { externalAccountId: string; accountId?: string; create?: { name: string; type?: string } }[];
    };
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ error: "mappings array is required" });
    }

    const linked = [];
    for (const m of mappings) {
      if (m.accountId) {
        const owned = await prisma.account.findFirst({ where: { id: m.accountId, userId: req.userId! } });
        if (!owned) continue;
        linked.push(await prisma.account.update({
          where: { id: owned.id },
          data: { bankConnectionId: connection.id, externalAccountId: m.externalAccountId, balanceSource: "bank_sync" },
        }));
      } else if (m.create) {
        const lastOrder = await prisma.account.findFirst({ where: { userId: req.userId! }, orderBy: { sortOrder: "desc" } });
        linked.push(await prisma.account.create({
          data: {
            userId: req.userId!,
            ownerUserId: req.authUserId!,
            householdId: req.householdId ?? null,
            name: m.create.name,
            type: m.create.type ?? "checking",
            bankConnectionId: connection.id,
            externalAccountId: m.externalAccountId,
            balanceSource: "bank_sync",
            sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
          },
        }));
      }
    }

    return res.json({ linked: linked.length });
  } catch (err) {
    console.error("[banking/link-accounts]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/banking/connections/:id/preview?accountId=<localAccountId>
// First-sync review step — same ImportPreview shape as /api/expenses/import/preview,
// so the frontend feeds it straight into the existing ImportStatement.tsx Step 2 UI.
bankingRouter.get("/connections/:id/preview", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { accountId } = req.query as Record<string, string>;
    const connection = await prisma.bankConnection.findFirst({ where: { id, userId: req.userId! } });
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const account = await prisma.account.findFirst({ where: { id: accountId, userId: req.userId!, bankConnectionId: connection.id } });
    if (!account || !account.externalAccountId) return res.status(400).json({ error: "Account is not linked to this connection" });

    const client = getBankingClient();
    if (!client) return res.status(503).json({ error: "Open Banking is not configured" });

    const txns = await client.getAccountTransactions(account.externalAccountId);
    const preview = await buildPreviewFromProviderTxns(connection.userId, connection.provider, txns);

    // Resolve suggested allocation names for display, matching /import/preview.
    const ids = [...new Set(preview.rows.map(r => r.suggestedAllocationId).filter(Boolean) as string[])];
    if (ids.length > 0) {
      const allocs = await prisma.allocation.findMany({ where: { id: { in: ids }, userId: req.userId! }, select: { id: true, name: true } });
      const nameById = Object.fromEntries(allocs.map(a => [a.id, a.name]));
      for (const r of preview.rows) if (r.suggestedAllocationId) r.suggestedAllocationName = nameById[r.suggestedAllocationId] ?? null;
    }

    return res.json(preview);
  } catch (err) {
    console.error("[banking/preview]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connections/:id/confirm
// body: { accountId, rows: ConfirmRow[] } — the user-reviewed rows from the
// first sync. Mirrors /api/expenses/import/confirm exactly, source: "bank_sync".
bankingRouter.post("/connections/:id/confirm", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const connection = await prisma.bankConnection.findFirst({ where: { id, userId: req.userId! } });
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const { accountId, rows } = req.body as {
      accountId: string;
      rows: { kind: "expense" | "income"; externalId: string; date: string; description: string; merchant: string; amount: number; allocationId?: string | null }[];
    };
    if (!accountId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "accountId and rows are required" });
    }
    const account = await prisma.account.findFirst({ where: { id: accountId, userId: req.userId!, bankConnectionId: connection.id } });
    if (!account) return res.status(400).json({ error: "Account is not linked to this connection" });

    const written = await writeSyncedRows(connection.userId, connection.ownerUserId, account.id, rows);

    await prisma.bankConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date(), lastSyncError: null } });

    return res.json({ success: true, expenses: written.expenses, income: written.income, inserted: written.expenses + written.income });
  } catch (err) {
    console.error("[banking/confirm]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/connections/:id/sync — manual "sync now", silent (no review).
bankingRouter.post("/connections/:id/sync", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const connection = await prisma.bankConnection.findFirst({ where: { id, userId: req.userId! } });
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    // NOTE: every field on SyncResult is a row count, not a money amount —
    // do NOT wrap this in serializeMoney(). "income" is a MONEY_KEYS entry
    // (used elsewhere for euro amounts), so it would silently divide this
    // count by 100 if passed through.
    const result = await syncConnection(id);
    return res.json(result);
  } catch (err) {
    console.error("[banking/sync]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/banking/sync-all — the external-cron target (Render Cron Job, OS
// cron via curl, etc.). Authenticated by a shared secret header, NOT user
// auth, since the caller is a scheduler, not a browser. Isolated per-connection
// error handling so one bad connection never blocks the rest.
bankingRouter.post("/sync-all", async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  if (req.headers["x-cron-secret"] !== secret) return res.status(401).json({ error: "Not authorized" });

  try {
    const connections = await prisma.bankConnection.findMany({ where: { status: "active" }, select: { id: true, institutionName: true } });
    const results = [];
    for (const c of connections) {
      const result = await syncConnection(c.id);
      results.push({ connectionId: c.id, institutionName: c.institutionName, ...result });
      if (!result.ok) console.error(`[banking/sync-all] connection ${c.id} (${c.institutionName}) failed:`, result.error);
    }
    return res.json({
      synced: results.length,
      succeeded: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    });
  } catch (err) {
    console.error("[banking/sync-all]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
