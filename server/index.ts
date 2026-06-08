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
import { incomeRouter } from "./routes/income.js";
import { recurringRouter } from "./routes/recurring.js";
import { analyticsRouter } from "./routes/analytics.js";
import { partnerRouter } from "./routes/partner.js";
import { stripeRouter } from "./routes/stripe.js";

const app = express();
const PORT = process.env.SERVER_PORT || 3002;

app.use(
  cors({
    origin: process.env.APP_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Raw body MUST come before express.json() for Stripe webhook signature verification
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "12mb" })); // statement uploads arrive base64-encoded in the body
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/plans", plansRouter);
app.use("/api/allocations", allocationsRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/plan-deposits", planDepositsRouter);
app.use("/api/monthly-budgets", monthlyBudgetsRouter);
app.use("/api/rules", rulesRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/income", incomeRouter);
app.use("/api/recurring", recurringRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/partner", partnerRouter);
app.use("/api/stripe", stripeRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[server] LifePlan running on http://localhost:${PORT}`);
});
