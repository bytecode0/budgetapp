import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "LifePlan <onboarding@resend.dev>";
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

// ── Brand colors ──────────────────────────────────────────────────────────────
const PRIMARY   = "#1E3A8A";
const SECONDARY = "#10B981";
const BG        = "#F8FAFC";
const TEXT      = "#1E293B";
const MUTED     = "#64748B";

function baseWrapper(content: string, headerColor = PRIMARY) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>LifePlan</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
    <!-- Header -->
    <div style="background:${headerColor};padding:32px 40px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;">🎯</div>
        <div>
          <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">LifePlan</div>
          <div style="color:rgba(255,255,255,0.75);font-size:12px;">Financial Life Planner</div>
        </div>
      </div>
    </div>
    <!-- Body -->
    <div style="padding:40px;">
      ${content}
    </div>
    <!-- Footer -->
    <div style="padding:24px 40px;border-top:1px solid #E2E8F0;background:#F8FAFC;">
      <p style="margin:0;font-size:12px;color:${MUTED};text-align:center;">
        LifePlan · Financial Life Planner<br/>
        <a href="${APP_URL}" style="color:${PRIMARY};text-decoration:none;">Visit LifePlan</a> ·
        <a href="mailto:support@lifeplan.app" style="color:${MUTED};text-decoration:none;">Contact Support</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function btn(href: string, label: string, color = SECONDARY) {
  return `<a href="${href}" style="display:inline-block;padding:14px 28px;background:${color};color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;margin:8px 0;">${label}</a>`;
}

function checkItem(text: string) {
  return `<li style="margin-bottom:8px;list-style:none;display:flex;align-items:flex-start;gap:8px;"><span style="color:${SECONDARY};font-size:16px;margin-top:1px;">✓</span><span style="color:${TEXT};">${text}</span></li>`;
}

// ── Subscription Activated ────────────────────────────────────────────────────
export async function sendSubscriptionActivatedEmail({
  to,
  name,
  renewalDate,
}: {
  to: string;
  name: string;
  renewalDate: Date;
}) {
  const dateStr = renewalDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const content = `
    <h2 style="margin:0 0 8px;color:${PRIMARY};font-size:26px;font-weight:700;">
      Welcome to LifePlan Premium! 🎉
    </h2>
    <p style="color:${MUTED};margin:0 0 24px;">Hi ${name}, your subscription is now active.</p>

    <div style="background:linear-gradient(135deg,${PRIMARY}15,${SECONDARY}15);border:1px solid ${SECONDARY}30;border-radius:12px;padding:24px;margin-bottom:28px;">
      <p style="margin:0 0 16px;font-weight:600;color:${TEXT};">You now have access to:</p>
      <ul style="margin:0;padding:0;">
        ${checkItem("AI-powered financial insights & recommendations")}
        ${checkItem("PDF export of plans and budget reports")}
        ${checkItem("Advanced projections with custom interest rates")}
        ${checkItem("Priority email support")}
        ${checkItem("LifePlan Premium badge")}
      </ul>
    </div>

    <div style="background:#F1F5F9;border-radius:10px;padding:16px 20px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <p style="margin:0;font-size:13px;color:${MUTED};">Next renewal</p>
        <p style="margin:4px 0 0;font-weight:600;color:${TEXT};">${dateStr}</p>
      </div>
      <div style="text-align:right;">
        <p style="margin:0;font-size:13px;color:${MUTED};">Amount</p>
        <p style="margin:4px 0 0;font-weight:700;color:${PRIMARY};font-size:18px;">€9.99/mo</p>
      </div>
    </div>

    <p style="margin:0 0 24px;color:${TEXT};">Start exploring your new premium features right away.</p>
    ${btn(`${APP_URL}`, "Open LifePlan")}

    <p style="margin:28px 0 0;font-size:13px;color:${MUTED};">
      You can manage or cancel your subscription at any time from <strong>Settings → Billing & Plan</strong>.
    </p>`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: "Welcome to LifePlan Premium! 🎉",
    html: baseWrapper(content, PRIMARY),
  });
}

// ── Subscription Cancelled ────────────────────────────────────────────────────
export async function sendSubscriptionCancelledEmail({
  to,
  name,
  accessUntilDate,
}: {
  to: string;
  name: string;
  accessUntilDate: Date;
}) {
  const dateStr = accessUntilDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT};font-size:24px;font-weight:700;">
      Your subscription has been cancelled
    </h2>
    <p style="color:${MUTED};margin:0 0 24px;">Hi ${name}, we've received your cancellation request.</p>

    <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
      <p style="margin:0;color:#92400E;font-weight:600;">
        📅 You still have Premium access until <strong>${dateStr}</strong>
      </p>
      <p style="margin:8px 0 0;color:#B45309;font-size:14px;">
        No further charges will be made. You can reactivate anytime before this date.
      </p>
    </div>

    <p style="margin:0 0 16px;color:${TEXT};">After ${dateStr}, your account will return to the Free plan. You'll lose access to:</p>
    <ul style="margin:0 0 24px;padding:0;">
      ${checkItem("AI-powered financial insights")}
      ${checkItem("PDF export of reports")}
      ${checkItem("Advanced projections with custom rates")}
      ${checkItem("Priority email support")}
    </ul>

    <p style="margin:0 0 16px;color:${TEXT};font-weight:600;">Changed your mind? Reactivate before ${dateStr}:</p>
    ${btn(`${APP_URL}/settings`, "Reactivate Premium", PRIMARY)}

    <p style="margin:24px 0 0;font-size:13px;color:${MUTED};">
      If you have feedback on why you cancelled, we'd love to hear it — just reply to this email.
    </p>`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: "Your LifePlan Premium subscription has been cancelled",
    html: baseWrapper(content, "#475569"),
  });
}

// ── Payment Failed ────────────────────────────────────────────────────────────
export async function sendPaymentFailedEmail({
  to,
  name,
}: {
  to: string;
  name: string;
}) {
  const content = `
    <h2 style="margin:0 0 8px;color:#DC2626;font-size:24px;font-weight:700;">
      ⚠️ Action required: Payment failed
    </h2>
    <p style="color:${MUTED};margin:0 0 24px;">Hi ${name}, we were unable to process your payment for LifePlan Premium.</p>

    <div style="background:#FEE2E2;border:1px solid #FECACA;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
      <p style="margin:0;color:#991B1B;font-weight:600;">
        Your Premium access may be suspended if payment is not updated soon.
      </p>
    </div>

    <p style="margin:0 0 24px;color:${TEXT};">
      Please update your payment method to continue enjoying LifePlan Premium features:
    </p>
    ${btn(`${APP_URL}/settings`, "Update Payment Method", "#DC2626")}

    <p style="margin:24px 0 0;font-size:13px;color:${MUTED};">
      If you need help, reply to this email or contact us at support@lifeplan.app.
    </p>`;

  await resend.emails.send({
    from: FROM,
    to,
    subject: "⚠️ Action required: Payment failed for LifePlan Premium",
    html: baseWrapper(content, "#DC2626"),
  });
}
