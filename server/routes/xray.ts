// Radiografía Financiera — public, unauthenticated routes.
//
// This is the app's first anonymous flow: a user uploads a bank statement, we
// analyze it in-memory, persist an ephemeral session (TTL) and return the
// result. No requireAuth. Because it's public and does real work, it carries a
// light per-IP rate limit and relies on the global 12mb body cap.
//
// Épica 0 (docs/scope-release.md), point 4: every route in this project uses
// requireAuth by convention. This router is THE explicit, listed exception —
// not an implicit one buried in a comment. Every endpoint below, rate limit
// tier, and why:
//   POST /analyze         — costly (parses a file, may call AI)
//   POST /quick-estimate   — costly (persists a session)
//   POST /add-account      — costly (parses more files into an existing session)
//   POST /reclassify       — costly (re-analyzes + writes)
//   POST /lead             — costly (sends an email)
//   POST /event            — light (fire-and-forget funnel beacon)
//   GET  /:id              — light (page refresh / share link)
//   POST /claim            — requireAuth AND gated behind budgetAppEnabled():
//                            it writes BudgetApp models, not the Radiografía.
//   GET  /metrics          — requireAuth (internal analytics, no rate limit).
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { budgetAppEnabled } from "../lib/featureFlags.js";
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
import { computeFuturoComprometido, type DebtKind } from "../lib/xray/debts.js";
import { debtLoadScore, stageFor, type HealthIndex, type HealthPillar } from "../lib/xray/healthIndex.js";
import { computeArchetype } from "../lib/xray/archetype.js";

export const xrayRouter = Router();

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;   // 48h
const MAX_TXNS = 5000;                        // sanity cap on a single upload

// --- Minimal in-memory per-IP rate limit (public endpoint abuse guard) ---
// Two tiers: the default is for state-mutating/costly operations (parses a
// file, may call the AI column-mapper, sends email). A lighter, much higher
// cap covers read/beacon endpoints (viewing your own report, funnel
// tracking) — sharing ONE counter across every endpoint would let a few page
// views + step-completed beacons burn through the same budget a real upload
// needs, breaking normal use of the funnel it's meant to protect.
const RATE_WINDOW_MS = 60 * 60 * 1000;        // 1h window
const RATE_MAX = 20;                          // costly ops per IP per window
const LIGHT_RATE_MAX = 300;                   // reads/beacons per IP per window
const hits = new Map<string, number[]>();
const lightHits = new Map<string, number[]>();

function checkRate(store: Map<string, number[]>, ip: string, max: number): boolean {
  const now = Date.now();
  const recent = (store.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  store.set(ip, recent);
  return recent.length > max;
}
function rateLimited(ip: string): boolean {
  return checkRate(hits, ip, RATE_MAX);
}
function rateLimitedLight(ip: string): boolean {
  return checkRate(lightHits, ip, LIGHT_RATE_MAX);
}

// Client IP for rate-limiting only (never for anything security-critical).
// Relies on `app.set("trust proxy", ...)` in server/index.ts — with that set,
// Express validates/trims the X-Forwarded-For chain itself, so `req.ip` is
// safe to use directly instead of reading the header by hand (which a client
// can set to whatever they like when there's no proxy validating it).
function clientIp(req: Request): string {
  return req.ip || "unknown";
}

const MAX_FILES = 5;
interface FileInput { filename: string; dataBase64: string }
// `extra` must round-trip: it carries the bank's other detail columns, which is
// where most of the meaning lives. Dropping it here would make reclassify and
// add-account re-analyze with less information than the first analysis did.
interface StoredTxn { date: string; concept: string; amount: number; balance: number | null; fileIndex?: number; extra?: string }

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
  txns.map(t => ({ date: t.date.toISOString(), concept: t.concept, amount: t.amount, balance: t.balance, fileIndex: t.fileIndex ?? 0, extra: t.extra }));

/** Rehydrate stored rows back into analyzable transactions (keeps `extra`). */
const storedToTagged = (stored: StoredTxn[]): TaggedTxn[] =>
  stored.map(s => ({ date: new Date(s.date), concept: s.concept, amount: s.amount, balance: s.balance, fileIndex: s.fileIndex ?? 0, extra: s.extra }));

// POST /api/xray/analyze — { filename, dataBase64 } | { files:[{filename,dataBase64}] } → { sessionId, result }
xrayRouter.post("/analyze", async (req: Request, res: Response) => {
  const ip = clientIp(req);
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

const DEBT_KINDS = new Set<DebtKind>(["credit_card", "installment", "bnpl", "payday_loan", "auto_loan", "other"]);
const MAX_QUICK_DEBTS = 20;

// POST /api/xray/quick-estimate — { monthlyIncome, debts:[{name,kind,monthlyPayment}] }
// → { sessionId, result }. No file, no parsing, no AI: the alternative entry
// point for a visitor who doesn't have a bank statement handy. Pure arithmetic
// over the same computeFuturoComprometido/debtLoadScore used by the full
// analyze() path, mapped into a reduced XRayResult (only `debts` + a
// single-pillar `health` are real; everything else is empty/zeroed) so it
// lands in the SAME XRaySession-backed funnel (email capture, PDF, account CTA)
// as the file-upload flow.
xrayRouter.post("/quick-estimate", async (req: Request, res: Response) => {
  const ip = clientIp(req);
  if (rateLimited(ip)) return res.status(429).json({ error: "rate_limited" });

  const { monthlyIncome, debts } = req.body ?? {};
  if (typeof monthlyIncome !== "number" || !Number.isFinite(monthlyIncome) || monthlyIncome < 0) {
    return res.status(400).json({ error: "invalid_input" });
  }
  if (!Array.isArray(debts) || debts.length === 0) return res.status(400).json({ error: "invalid_input" });
  if (debts.length > MAX_QUICK_DEBTS) return res.status(400).json({ error: "too_many_debts" });

  const clean: { name: string; kind: DebtKind; monthlyPayment: number }[] = [];
  for (const d of debts) {
    if (
      !d || typeof d.name !== "string" || !d.name.trim() ||
      !DEBT_KINDS.has(d.kind) ||
      typeof d.monthlyPayment !== "number" || !Number.isFinite(d.monthlyPayment) || d.monthlyPayment < 0
    ) {
      return res.status(400).json({ error: "invalid_input" });
    }
    clean.push({ name: d.name.trim().slice(0, 80), kind: d.kind, monthlyPayment: d.monthlyPayment });
  }

  const monthlyDebtTotal = clean.reduce((s, d) => s + d.monthlyPayment, 0);
  const { pctOfIncome } = computeFuturoComprometido(monthlyDebtTotal, monthlyIncome);
  const score = Math.round(debtLoadScore(pctOfIncome));
  const pillar: HealthPillar = { key: "debtLoad", label: "debtLoad", score, weight: 1, caption: "debtLoad" };
  const health: HealthIndex = { score, stage: stageFor(score), pillars: [pillar], strongestKey: "debtLoad" };
  // A manual estimate only knows about debt: there's no giving history to judge
  // and no surplus to see, so the archetype comes out on the debt axis alone and
  // says so via givingAssessed: false.
  const archetype = computeArchetype({
    monthsCovered: 1,
    incomeCents: Math.round(monthlyIncome * 100),
    givingMonths: 0,
    givingAmounts: [],
    savingsCents: 0,
    investmentCents: 0,
    debtPctOfIncome: pctOfIncome,
  });

  const result: XRayResult = {
    period: { from: "", to: "", months: 1 },
    summary: {
      totalIncome: monthlyIncome,
      totalExpenses: monthlyDebtTotal,
      net: monthlyIncome - monthlyDebtTotal,
      savingsRate: monthlyIncome > 0 ? (monthlyIncome - monthlyDebtTotal) / monthlyIncome : 0,
      transactionCount: clean.length,
    },
    categories: [],
    antExpenses: { monthlyAvg: 0, annualized: 0, items: [] },
    recurring: { monthlyTotal: 0, annualized: 0, count: 0, items: [] },
    wealth: { total: 0, savings: 0, giving: 0, investment: 0, items: [] },
    uncertain: { total: 0, items: [] },
    income: { excluded: { total: 0, items: [] }, uncertain: { total: 0, items: [] } },
    internalTransfers: { count: 0, total: 0, items: [] },
    balances: { hasData: false, total: 0, accounts: [], runwayMonths: null },
    debts: {
      monthlyTotal: monthlyDebtTotal,
      pctOfIncome,
      items: clean.map(d => ({ merchant: d.name, kind: d.kind, monthlyAmount: d.monthlyPayment })),
      mortgage: null,
    },
    topMerchants: [],
    health,
    archetype,
    opportunities: [],
  };

  const session = await prisma.xRaySession.create({
    data: {
      result: result as unknown as object,
      transactions: [] as unknown as object,
      bank: "manual",
      txnCount: 0,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
    select: { id: true },
  });

  return res.json({ sessionId: session.id, result });
});

// POST /api/xray/add-account — { sessionId, files:[…] } → append account(s) to an
// existing session and re-analyze the combined set (detects internal transfers).
xrayRouter.post("/add-account", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
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
  const existing: TaggedTxn[] = storedToTagged(stored);
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
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
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
    // "wealth" is still accepted: sessions created before savings/investment
    // were separate answers stored it, and their results must keep resolving.
    // "income"/"notIncome" answer the OTHER axis — is an ambiguous inflow real
    // income or money that was already yours moving around.
    if (
      v === "consumption" || v === "savings" || v === "investment" || v === "giving" || v === "wealth" ||
      v === "income" || v === "notIncome"
    ) {
      clean[m] = v;
    }
  }

  const stored = (session.transactions as unknown as StoredTxn[]) ?? [];
  const txns: TaggedTxn[] = storedToTagged(stored);
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
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
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
// BudgetApp functionality (writes Allocation/Expense/Income), not launching
// 12 Sep 2026 — gated even though it lives inside the otherwise-public xrayRouter.
// The flag check MUST run as its own middleware ahead of requireAuth: an
// unauthenticated request hitting requireAuth first gets a 401, which is
// exactly the "something's there" leak the flag exists to prevent.
xrayRouter.post(
  "/claim",
  (_req: Request, res: Response, next) => {
    if (!budgetAppEnabled()) return res.status(404).json({ error: "not_found" });
    next();
  },
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== "string") return res.status(400).json({ error: "missing_session" });
    try {
      const result = await hydrateFromXraySession(req.authUserId!, sessionId);
      return res.json(result);
    } catch (err) {
      console.error("[xray/claim]", err);
      return res.status(500).json({ error: "hydrate_failed" });
    }
  },
);

// Whitelisted funnel steps (R6). Anything else is ignored.
const EVENTS = new Set([
  "page_view", "analyze_started", "analyze_completed", "results_viewed",
  "wow_reached", "email_captured", "account_cta_clicked", "share_clicked", "reclassified", "add_account",
  // Drop-off on the mandatory classification gate is the number to watch: it's
  // the one step that trades funnel completion for an honest verdict.
  "classify_completed",
]);

// POST /api/xray/event — { event, sessionId? } — anonymous funnel analytics. Fire-and-forget.
xrayRouter.post("/event", async (req: Request, res: Response) => {
  // Light limiter: this is a fire-and-forget beacon fired several times per
  // real session (page_view + one paso_completado per step + ...). The
  // 20/hour costly-op limiter would throttle a single legitimate visitor.
  if (rateLimitedLight(clientIp(req))) return res.status(204).end();
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
  if (rateLimitedLight(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
  const session = await prisma.xRaySession.findUnique({
    where: { id: req.params.id },
    select: { result: true, expiresAt: true, bank: true, txnCount: true },
  });
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.expiresAt.getTime() < Date.now()) return res.status(410).json({ error: "expired" });

  return res.json({ result: session.result, bank: session.bank, txnCount: session.txnCount });
});
