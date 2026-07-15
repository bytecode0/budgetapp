// Radiografía Financiera — public, unauthenticated routes.
//
// This is the app's first anonymous flow: a user uploads a bank statement, we
// analyze it in-memory, persist an ephemeral session (TTL) and return the
// result. No requireAuth. Because it's public and does real work, it carries a
// light per-IP rate limit and relies on the global 12mb body cap.
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { readGrid, externalIdFor } from "../lib/importStatement.js";
import { gridToTransactions } from "../lib/parsers/bbva.js";
import { mapColumnsWithAI } from "../lib/xray/aiColumnMap.js";
import { gridToTransactionsGeneric } from "../lib/xray/genericParser.js";
import { normalizeMerchant } from "../lib/normalizeMerchant.js";
import { suggestCategories } from "../lib/ai/suggestCategories.js";
import { aiEnabled } from "../lib/ai/client.js";
import { analyze, type XRayResult, type Overrides, type TaggedTxn } from "../lib/xray/analyze.js";
import { hydrateFromXraySession } from "../lib/xray/hydrate.js";
import { generateXrayPdf } from "../lib/xray/pdf.js";
import { sendXrayReportEmail } from "../lib/mailer.js";

export const xrayRouter = Router();

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;   // 48h
const MAX_TXNS = 5000;                        // sanity cap on a single upload

// --- Minimal in-memory per-IP rate limit (public endpoint abuse guard) ---
const RATE_WINDOW_MS = 60 * 60 * 1000;        // 1h window
const RATE_MAX = 20;                          // analyses per IP per window
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_MAX;
}

const MAX_FILES = 5;
interface FileInput { filename: string; dataBase64: string }
interface StoredTxn { date: string; concept: string; amount: number; balance: number | null; fileIndex?: number }

// Parse one uploaded file into tagged transactions: deterministic BBVA parser
// first, AI column-mapping fallback second. Never throws.
async function parseFile(f: FileInput, fileIndex: number): Promise<{ txns: TaggedTxn[]; bank: string }> {
  let grid: unknown[][];
  try { grid = readGrid(Buffer.from(f.dataBase64, "base64"), f.filename); }
  catch { return { txns: [], bank: "unreadable" }; }
  try {
    const txns = gridToTransactions(grid).filter(t => t.amount !== 0);
    return { txns: txns.map(t => ({ ...t, fileIndex })), bank: "bbva" };
  } catch {
    const mapping = aiEnabled() ? await mapColumnsWithAI(grid) : null;
    if (mapping) {
      const txns = gridToTransactionsGeneric(grid, mapping).filter(t => t.amount !== 0);
      return { txns: txns.map(t => ({ ...t, fileIndex })), bank: "generic" };
    }
    return { txns: [], bank: "unrecognized" };
  }
}

// Drop exact duplicate rows (same file uploaded twice, or overlapping ranges).
function dedupeTxns(txns: TaggedTxn[]): TaggedTxn[] {
  const seen = new Set<string>();
  const out: TaggedTxn[] = [];
  for (const t of txns) {
    const id = externalIdFor(t, normalizeMerchant(t.concept));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

// Accept either { filename, dataBase64 } (back-compat) or { files: [...] }.
function filesFromBody(body: any): FileInput[] | null {
  if (Array.isArray(body?.files)) {
    const fs = body.files.filter((f: any) => typeof f?.filename === "string" && typeof f?.dataBase64 === "string" && f.dataBase64);
    return fs.length ? fs : null;
  }
  if (typeof body?.filename === "string" && typeof body?.dataBase64 === "string" && body.dataBase64) {
    return [{ filename: body.filename, dataBase64: body.dataBase64 }];
  }
  return null;
}

const storableTxns = (txns: TaggedTxn[]) =>
  txns.map(t => ({ date: t.date.toISOString(), concept: t.concept, amount: t.amount, balance: t.balance, fileIndex: t.fileIndex ?? 0 }));

// POST /api/xray/analyze — { filename, dataBase64 } | { files:[{filename,dataBase64}] } → { sessionId, result }
xrayRouter.post("/analyze", async (req: Request, res: Response) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "rate_limited" });

  const files = filesFromBody(req.body);
  if (!files) return res.status(400).json({ error: "missing_file" });
  if (files.length > MAX_FILES) return res.status(400).json({ error: "too_many_files" });

  let merged: TaggedTxn[] = [];
  let anyReadable = false;
  const banks = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const { txns, bank } = await parseFile(files[i], i);
    if (bank !== "unreadable") anyReadable = true;
    if (txns.length) { merged.push(...txns); banks.add(bank); }
  }
  if (merged.length === 0) return res.status(422).json({ error: anyReadable ? "unrecognized_format" : "unreadable_file" });

  merged = dedupeTxns(merged);
  if (merged.length > MAX_TXNS) return res.status(413).json({ error: "too_many_transactions" });

  const bank = files.length > 1 ? "multi" : (banks.has("generic") ? "generic" : "bbva");

  // Optional AI category grouping (degrades to local taxonomy when disabled).
  let aiCategories;
  if (aiEnabled()) {
    const merchants = [...new Set(merged.filter(t => t.amount < 0).map(t => normalizeMerchant(t.concept)).filter(Boolean))];
    aiCategories = await suggestCategories(merchants);
  }

  const result = analyze(merged, aiCategories);

  const session = await prisma.xRaySession.create({
    data: {
      result: result as unknown as object,
      transactions: storableTxns(merged) as unknown as object,
      aiCategories: (aiCategories ?? null) as unknown as object,
      bank,
      txnCount: merged.length,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
    select: { id: true },
  });

  return res.json({ sessionId: session.id, result });
});

// POST /api/xray/add-account — { sessionId, files:[…] } → append account(s) to an
// existing session and re-analyze the combined set (detects internal transfers).
xrayRouter.post("/add-account", async (req: Request, res: Response) => {
  const { sessionId } = req.body ?? {};
  const files = filesFromBody(req.body);
  if (typeof sessionId !== "string" || !files) return res.status(400).json({ error: "invalid_input" });
  if (files.length > MAX_FILES) return res.status(400).json({ error: "too_many_files" });

  const session = await prisma.xRaySession.findUnique({
    where: { id: sessionId },
    select: { transactions: true, aiCategories: true, overrides: true, expiresAt: true, claimedByUserId: true },
  });
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.expiresAt.getTime() < Date.now()) return res.status(410).json({ error: "expired" });
  if (session.claimedByUserId) return res.status(409).json({ error: "already_claimed" });

  const stored = (session.transactions as unknown as StoredTxn[]) ?? [];
  const existing: TaggedTxn[] = stored.map(s => ({ date: new Date(s.date), concept: s.concept, amount: s.amount, balance: s.balance, fileIndex: s.fileIndex ?? 0 }));
  const nextIndex = existing.reduce((m, t) => Math.max(m, t.fileIndex ?? 0), 0) + 1;

  let added: TaggedTxn[] = [];
  let anyReadable = false;
  for (let i = 0; i < files.length; i++) {
    const { txns, bank } = await parseFile(files[i], nextIndex + i);
    if (bank !== "unreadable") anyReadable = true;
    if (txns.length) added.push(...txns);
  }
  if (added.length === 0) return res.status(422).json({ error: anyReadable ? "unrecognized_format" : "unreadable_file" });

  const merged = dedupeTxns([...existing, ...added]);
  if (merged.length > MAX_TXNS) return res.status(413).json({ error: "too_many_transactions" });

  const aiCategories = (session.aiCategories as unknown as any[]) ?? undefined;
  const overrides = (session.overrides as unknown as Overrides) ?? {};
  const result = analyze(merged, aiCategories, overrides);

  await prisma.xRaySession.update({
    where: { id: sessionId },
    data: { result: result as unknown as object, transactions: storableTxns(merged) as unknown as object, bank: "multi", txnCount: merged.length },
  });
  return res.json({ result });
});

// POST /api/xray/reclassify — { sessionId, overrides } → recompute with the user's
// movement corrections (merchant → consumption|wealth), persist, return the new
// result. Keeps analyze() the single source of truth so the PDF + hydration match.
xrayRouter.post("/reclassify", async (req: Request, res: Response) => {
  const { sessionId, overrides } = req.body ?? {};
  if (typeof sessionId !== "string" || typeof overrides !== "object" || overrides === null) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const session = await prisma.xRaySession.findUnique({
    where: { id: sessionId },
    select: { transactions: true, aiCategories: true, expiresAt: true, claimedByUserId: true },
  });
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.expiresAt.getTime() < Date.now()) return res.status(410).json({ error: "expired" });
  if (session.claimedByUserId) return res.status(409).json({ error: "already_claimed" });

  // Sanitize overrides to the expected shape.
  const clean: Overrides = {};
  for (const [m, v] of Object.entries(overrides as Record<string, unknown>)) {
    if (v === "consumption" || v === "wealth") clean[m] = v;
  }

  const stored = (session.transactions as unknown as StoredTxn[]) ?? [];
  const txns: TaggedTxn[] = stored.map(s => ({ date: new Date(s.date), concept: s.concept, amount: s.amount, balance: s.balance, fileIndex: s.fileIndex ?? 0 }));
  const ai = (session.aiCategories as unknown as any[]) ?? undefined;
  const result = analyze(txns, ai, clean);

  await prisma.xRaySession.update({
    where: { id: sessionId },
    data: { result: result as unknown as object, overrides: clean as unknown as object },
  });
  return res.json({ result });
});

// POST /api/xray/lead — { sessionId, email } → attach the email to the session.
// The PDF + eBook send (Resend) lands in R4; here we just capture the lead.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
xrayRouter.post("/lead", async (req: Request, res: Response) => {
  const { sessionId, email } = req.body ?? {};
  if (typeof sessionId !== "string" || typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const session = await prisma.xRaySession.findUnique({ where: { id: sessionId }, select: { id: true, expiresAt: true, result: true } });
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.expiresAt.getTime() < Date.now()) return res.status(410).json({ error: "expired" });

  const to = email.toLowerCase().trim();
  await prisma.xRaySession.update({ where: { id: sessionId }, data: { email: to } });

  // Generate + email the PDF report (Spanish). Best-effort: the lead is already
  // captured, so a mail/render failure must not fail the request.
  if (process.env.RESEND_API_KEY) {
    try {
      const result = session.result as unknown as XRayResult;
      const pdf = await generateXrayPdf(result, "es");
      await sendXrayReportEmail(to, pdf, result?.health?.score ?? 0);
    } catch (err) {
      console.error("[xray/lead] report send", err);
    }
  }

  return res.json({ ok: true });
});

// POST /api/xray/claim — { sessionId } → hydrate the authenticated user's brand-new
// account from the x-ray transactions. One-shot & idempotent (guarded server-side).
xrayRouter.post("/claim", requireAuth, async (req: AuthRequest, res: Response) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId !== "string") return res.status(400).json({ error: "missing_session" });
  try {
    const result = await hydrateFromXraySession(req.authUserId!, sessionId);
    return res.json(result);
  } catch (err) {
    console.error("[xray/claim]", err);
    return res.status(500).json({ error: "hydrate_failed" });
  }
});

// Whitelisted funnel steps (R6). Anything else is ignored.
const EVENTS = new Set([
  "page_view", "analyze_started", "analyze_completed", "results_viewed",
  "wow_reached", "email_captured", "account_cta_clicked", "share_clicked", "reclassified", "add_account",
]);

// POST /api/xray/event — { event, sessionId? } — anonymous funnel analytics. Fire-and-forget.
xrayRouter.post("/event", async (req: Request, res: Response) => {
  const { event, sessionId } = req.body ?? {};
  if (typeof event !== "string" || !EVENTS.has(event)) return res.status(204).end();
  try {
    await prisma.xRayEvent.create({
      data: { event, sessionId: typeof sessionId === "string" ? sessionId : null },
    });
  } catch { /* best-effort */ }
  return res.status(204).end();
});

// GET /api/xray/metrics — funnel aggregates (requireAuth). Non-PII counts.
xrayRouter.get("/metrics", requireAuth, async (_req: AuthRequest, res: Response) => {
  const [analyzed, withEmail, claimed, grouped] = await Promise.all([
    prisma.xRaySession.count(),
    prisma.xRaySession.count({ where: { email: { not: null } } }),
    prisma.xRaySession.count({ where: { claimedByUserId: { not: null } } }),
    prisma.xRayEvent.groupBy({ by: ["event"], _count: { event: true } }),
  ]);
  const events: Record<string, number> = {};
  for (const g of grouped) events[g.event] = g._count.event;

  const pageViews = events.page_view ?? 0;
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  return res.json({
    funnel: {
      pageViews,
      analyzed,                       // sessions created = analysis completed
      wowReached: events.wow_reached ?? 0,
      emailCaptured: withEmail,
      accountsCreated: claimed,
    },
    conversion: {
      viewToAnalyze: rate(analyzed, pageViews),
      analyzeToEmail: rate(withEmail, analyzed),
      emailToAccount: rate(claimed, withEmail),
      viewToAccount: rate(claimed, pageViews),
    },
    events,
  });
});

// GET /api/xray/:id — re-fetch a result (page refresh / share link). Not the raw rows.
xrayRouter.get("/:id", async (req: Request, res: Response) => {
  const session = await prisma.xRaySession.findUnique({
    where: { id: req.params.id },
    select: { result: true, expiresAt: true, bank: true, txnCount: true },
  });
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.expiresAt.getTime() < Date.now()) return res.status(410).json({ error: "expired" });

  return res.json({ result: session.result, bank: session.bank, txnCount: session.txnCount });
});
