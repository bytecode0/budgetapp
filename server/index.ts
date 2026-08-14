import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { budgetAppEnabled } from "./lib/featureFlags.js";
import { xrayRouter } from "./routes/xray.js";
import { radiografiaRouter } from "./routes/radiografia.js";
import { internalPurgeRouter } from "./routes/internalPurge.js";

const app = express();
const PORT = process.env.SERVER_PORT || 3002;
const BUDGETAPP_ENABLED = budgetAppEnabled();

// Trusts exactly one hop (the reverse proxy this Node process sits behind in
// every deployment target we run on). Without this, req.ip is either the
// proxy's own address (useless for rate-limiting) or, if code reads
// X-Forwarded-For by hand instead, a client-supplied value with no
// validation at all — trivially spoofable. With trust proxy set, Express
// validates/trims that header itself and req.ip becomes safe to rely on
// (see clientIp() in routes/xray.ts). If a deployment adds a second hop
// (e.g. a CDN in front of the existing proxy), bump this to 2.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.APP_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Raw body MUST be registered before express.json() below, unconditionally —
// Express applies middleware in registration order regardless of path
// specificity, so a global express.json() registered first would consume the
// webhook body before this path-specific override ever got a chance to run.
// Harmless when BudgetApp is disabled: stripeRouter itself is never mounted,
// so nothing ever reads req.body on this path anyway.
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "12mb" })); // statement uploads arrive base64-encoded in the body
app.use(cookieParser());

// ---- Public routes ----
// The convention everywhere else in this project is requireAuth on every
// route. The Radiografía is the ONE exception, and it's listed here
// explicitly rather than being an implicit exception buried in a router file.
app.use("/api/xray", xrayRouter);
app.use("/api/radiografia", radiografiaRouter);
app.use("/api/internal", internalPurgeRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// ---- BudgetApp routes ----
// Not launching 12 Sep 2026 (docs/scope-release.md, Épica 0). Every route below
// is behind requireAuth internally AND behind this flag: with it off, none of
// these routers even mount, so a request to e.g. /api/plans falls through to
// the catch-all 404 below — never a 401, which would leak that something is
// there. Dynamic imports so the modules aren't even loaded when disabled.
if (BUDGETAPP_ENABLED) {
  const [
    { authRouter },
    { plansRouter },
    { allocationsRouter },
    { expensesRouter },
    { planDepositsRouter },
    { monthlyBudgetsRouter },
    { rulesRouter },
    { accountsRouter },
    { debtsRouter },
    { bankingRouter },
    { incomeRouter },
    { recurringRouter },
    { analyticsRouter },
    { partnerRouter },
    { householdsRouter },
    { dashboardRouter },
    { stripeRouter },
    { aiRouter },
  ] = await Promise.all([
    import("./routes/auth.js"),
    import("./routes/plans.js"),
    import("./routes/allocations.js"),
    import("./routes/expenses.js"),
    import("./routes/planDeposits.js"),
    import("./routes/monthlyBudgets.js"),
    import("./routes/rules.js"),
    import("./routes/accounts.js"),
    import("./routes/debts.js"),
    import("./routes/banking.js"),
    import("./routes/income.js"),
    import("./routes/recurring.js"),
    import("./routes/analytics.js"),
    import("./routes/partner.js"),
    import("./routes/households.js"),
    import("./routes/dashboard.js"),
    import("./routes/stripe.js"),
    import("./routes/ai.js"),
  ]);

  app.use("/api/auth", authRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/allocations", allocationsRouter);
  app.use("/api/expenses", expensesRouter);
  app.use("/api/plan-deposits", planDepositsRouter);
  app.use("/api/monthly-budgets", monthlyBudgetsRouter);
  app.use("/api/rules", rulesRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/debts", debtsRouter);
  app.use("/api/banking", bankingRouter);
  app.use("/api/income", incomeRouter);
  app.use("/api/recurring", recurringRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/partner", partnerRouter);
  app.use("/api/households", householdsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/stripe", stripeRouter);
  app.use("/api/ai", aiRouter);
}

// Anything else under /api — including every BudgetApp route when the flag is
// off — is a clean JSON 404 matching the { error } response convention. Never
// falls through to Express's default HTML error page.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.log(`[server] LifePlan running on http://localhost:${PORT} (BudgetApp: ${BUDGETAPP_ENABLED ? "enabled" : "disabled"})`);
});
