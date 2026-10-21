import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { plansRouter } from "./routes/plans.js";
import { allocationsRouter } from "./routes/allocations.js";
import { expensesRouter } from "./routes/expenses.js";
import { planDepositsRouter } from "./routes/planDeposits.js";
import { monthlyBudgetsRouter } from "./routes/monthlyBudgets.js";
import { rulesRouter } from "./routes/rules.js";
import { accountsRouter } from "./routes/accounts.js";
import { debtsRouter } from "./routes/debts.js";
import { bankingRouter } from "./routes/banking.js";
import { incomeRouter } from "./routes/income.js";
import { recurringRouter } from "./routes/recurring.js";
import { analyticsRouter } from "./routes/analytics.js";
import { partnerRouter } from "./routes/partner.js";
import { householdsRouter } from "./routes/households.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { stripeRouter } from "./routes/stripe.js";
import { aiRouter } from "./routes/ai.js";
import { onboardingRouter } from "./routes/onboarding.js";

const app = express();
const PORT = process.env.SERVER_PORT || 3002;

// Trusts exactly one hop (the reverse proxy this Node process sits behind in
// every deployment target we run on). Without this, req.ip is either the
// proxy's own address (useless for rate-limiting) or, if code reads
// X-Forwarded-For by hand instead, a client-supplied value with no
// validation at all — trivially spoofable. With trust proxy set, Express
// validates/trims that header itself and req.ip becomes safe to rely on. If a
// deployment adds a second hop
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
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "12mb" })); // statement uploads arrive base64-encoded in the body
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// ---- Routes ----
// Every route is behind requireAuth internally; the exceptions are the auth
// endpoints themselves and the Stripe webhook, which verifies its signature.
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
app.use("/api/onboarding", onboardingRouter);

// Anything else under /api is a clean JSON 404 matching the { error } response
// convention. Never falls through to Express's default HTML error page.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.log(`[server] LifePlan running on http://localhost:${PORT}`);
});
