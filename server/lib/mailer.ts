import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Sin dominio verificado: FROM = onboarding@resend.dev (solo entrega al email de tu cuenta Resend)
// Con dominio verificado: EMAIL_FROM=LifePlan <noreply@tudominio.com>
const FROM = process.env.EMAIL_FROM ?? "LifePlan <onboarding@resend.dev>";
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const LOGO_URL = process.env.LOGO_URL ?? null;

// ─── Shared building blocks ───────────────────────────────────────────────────

function wrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LifePlan</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background-color:#F0F4FF;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0F4FF;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo header -->
          <tr>
            <td style="padding-bottom:32px;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background:#FFFFFF;border:1px solid rgba(30,58,138,0.15);border-radius:12px;padding:10px 20px;box-shadow:0 2px 8px rgba(30,58,138,0.08);">
                    <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="vertical-align:middle;padding-right:9px;">
                          ${LOGO_URL
                            ? `<img src="${LOGO_URL}" alt="LifePlan" width="22" height="22" style="display:block;border-radius:4px;" />`
                            : `<table cellpadding="0" cellspacing="0"><tr><td style="width:22px;height:22px;background:linear-gradient(135deg,#1E3A8A 0%,#10B981 100%);border-radius:6px;text-align:center;vertical-align:middle;font-size:13px;font-weight:900;color:#FFFFFF;font-family:Arial,sans-serif;line-height:22px;">&#9679;</td></tr></table>`
                          }
                        </td>
                        <td style="vertical-align:middle;">
                          <span style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:17px;font-weight:700;letter-spacing:-0.4px;color:#1E3A8A;">LifePlan</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#FFFFFF;border:1px solid rgba(30,58,138,0.1);border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(30,58,138,0.08);">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 0 0;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#6B7280;">
                LifePlan &mdash; Your financial life planner
              </p>
              <p style="margin:0;font-size:11px;color:#9CA3AF;">
                You received this email because you have an account at LifePlan.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function gradientBadge(text: string): string {
  return `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;
    background:linear-gradient(90deg,#1E3A8A 0%,#10B981 100%);color:#ffffff;">${text}</span>`;
}

function ctaButton(label: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr>
      <td style="border-radius:12px;background:linear-gradient(90deg,#1E3A8A 0%,#10B981 100%);">
        <a href="${href}" target="_blank"
           style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;
                  color:#ffffff;text-decoration:none;letter-spacing:-0.2px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

function divider(): string {
  return `<tr><td style="padding:0 32px;"><div style="height:1px;background:#F3F4F6;"></div></td></tr>`;
}

function featureRow(icon: string, text: string): string {
  return `<tr>
    <td style="padding:6px 0;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:24px;vertical-align:top;padding-top:1px;">
            <span style="font-size:14px;">${icon}</span>
          </td>
          <td style="padding-left:8px;font-size:14px;color:#6B7280;line-height:1.5;">${text}</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ─── 1. Verification OTP ─────────────────────────────────────────────────────

export async function sendVerificationEmail(email: string, name: string, otp: string) {
  const firstName = name.split(" ")[0];

  const html = wrapper(`
    <!-- Top accent bar -->
    <tr><td style="height:4px;background:linear-gradient(90deg,#1E3A8A 0%,#10B981 100%);"></td></tr>

    <!-- Content -->
    <tr>
      <td style="padding:40px 40px 16px;">
        <p style="margin:0 0 20px;">${gradientBadge("VERIFY YOUR ACCOUNT")}</p>
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#111827;line-height:1.25;">
          Welcome, ${firstName}! 👋
        </h1>
        <p style="margin:0;font-size:15px;color:#6B7280;line-height:1.6;">
          You're almost there. Enter this code to verify your email address and activate your LifePlan account.
        </p>
      </td>
    </tr>

    <!-- OTP Box -->
    <tr>
      <td style="padding:28px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#F0F4FF;border:2px solid rgba(30,58,138,0.2);border-radius:14px;padding:28px;text-align:center;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:2px;color:#6B7280;text-transform:uppercase;">
                Your verification code
              </p>
              <p style="margin:0;font-size:48px;font-weight:800;letter-spacing:18px;color:#1E3A8A;
                         font-family:'JetBrains Mono','Courier New',Courier,monospace;line-height:1.1;">
                ${otp}
              </p>
              <p style="margin:12px 0 0;font-size:12px;color:#9CA3AF;">
                Expires in <strong style="color:#6B7280;">15 minutes</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${divider()}

    <!-- Footer note -->
    <tr>
      <td style="padding:20px 40px 36px;">
        <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;">
          🔒 This code is single-use and will expire automatically. If you didn't create a LifePlan account, you can safely ignore this email.
        </p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `${otp} is your LifePlan verification code`,
    html,
  });

  if (error) { console.error("[mailer/sendVerificationEmail]", error); throw new Error(error.message); }
}

// ─── 2. Password Reset OTP ───────────────────────────────────────────────────

export async function sendPasswordResetEmail(email: string, otp: string) {
  const html = wrapper(`
    <!-- Top accent bar -->
    <tr><td style="height:4px;background:linear-gradient(90deg,#F59E0B 0%,#EF4444 100%);"></td></tr>

    <!-- Content -->
    <tr>
      <td style="padding:40px 40px 16px;">
        <p style="margin:0 0 20px;"><span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;background:linear-gradient(90deg,#F59E0B 0%,#EF4444 100%);color:#ffffff;">PASSWORD RESET</span></p>
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#111827;line-height:1.25;">
          Reset your password
        </h1>
        <p style="margin:0;font-size:15px;color:#6B7280;line-height:1.6;">
          We received a request to reset your LifePlan password. Use the code below to set a new password.
        </p>
      </td>
    </tr>

    <!-- OTP Box -->
    <tr>
      <td style="padding:28px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#FFFBEB;border:2px solid rgba(245,158,11,0.3);border-radius:14px;padding:28px;text-align:center;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:2px;color:#6B7280;text-transform:uppercase;">
                Reset code
              </p>
              <p style="margin:0;font-size:48px;font-weight:800;letter-spacing:18px;color:#92400E;
                         font-family:'JetBrains Mono','Courier New',Courier,monospace;line-height:1.1;">
                ${otp}
              </p>
              <p style="margin:12px 0 0;font-size:12px;color:#9CA3AF;">
                Expires in <strong style="color:#6B7280;">15 minutes</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${divider()}

    <!-- Warning -->
    <tr>
      <td style="padding:20px 40px 36px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#FFF7ED;border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:14px 16px;">
              <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.6;">
                ⚠️ <strong style="color:#111827;">Didn't request this?</strong> If you didn't ask to reset your password, someone may have entered your email by mistake. No changes have been made to your account.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `${otp} — Reset your LifePlan password`,
    html,
  });

  if (error) { console.error("[mailer/sendPasswordResetEmail]", error); throw new Error(error.message); }
}

// ─── 3. Welcome — email verified ─────────────────────────────────────────────

export async function sendWelcomeEmail(email: string, name: string) {
  const firstName = name.split(" ")[0];

  const html = wrapper(`
    <!-- Top accent bar -->
    <tr><td style="height:4px;background:linear-gradient(90deg,#1E3A8A 0%,#10B981 100%);"></td></tr>

    <!-- Hero -->
    <tr>
      <td style="padding:48px 40px 32px;text-align:center;">
        <div style="width:64px;height:64px;background:linear-gradient(135deg,rgba(16,185,129,0.15) 0%,rgba(30,58,138,0.1) 100%);border:2px solid rgba(16,185,129,0.3);
                    border-radius:50%;margin:0 auto 20px;text-align:center;line-height:64px;font-size:28px;">
          ✓
        </div>
        <h1 style="margin:0 0 10px;font-size:28px;font-weight:800;color:#111827;line-height:1.2;">
          You're in, ${firstName}!
        </h1>
        <p style="margin:0 auto;font-size:15px;color:#6B7280;line-height:1.6;max-width:380px;">
          Your LifePlan account is verified and ready. Start building your financial future today.
        </p>
      </td>
    </tr>

    ${divider()}

    <!-- Features -->
    <tr>
      <td style="padding:28px 40px;">
        <p style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:1px;color:#6B7280;text-transform:uppercase;">
          What you can do right now
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${featureRow("🎯", "<strong style='color:#111827;'>Create life plans</strong> — set goals for travel, a car, a house, or a business")}
          ${featureRow("💸", "<strong style='color:#111827;'>Track your spending</strong> — see how daily expenses align with your goals")}
          ${featureRow("📊", "<strong style='color:#111827;'>Allocate income</strong> — divide your income across your plans with intention")}
          ${featureRow("✨", "<strong style='color:#111827;'>Get smart insights</strong> — AI-powered tips to optimize your financial journey")}
        </table>
      </td>
    </tr>

    ${divider()}

    <!-- CTA -->
    <tr>
      <td style="padding:32px 40px 40px;text-align:center;">
        ${ctaButton("Start planning my future →", `${APP_URL}`)}
        <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;">
          Free plan · No credit card required
        </p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Welcome to LifePlan, ${firstName}! Your account is ready`,
    html,
  });

  if (error) { console.error("[mailer/sendWelcomeEmail]", error); throw new Error(error.message); }
}

// ─── 4. Partner invite ───────────────────────────────────────────────────────

export async function sendPartnerInviteEmail(
  invitedEmail: string,
  senderName: string,
  acceptUrl: string,
) {
  const html = wrapper(`
    <!-- Top accent bar -->
    <tr><td style="height:4px;background:linear-gradient(90deg,#8B5CF6 0%,#EC4899 100%);"></td></tr>

    <!-- Hero -->
    <tr>
      <td style="padding:48px 40px 32px;text-align:center;">
        <div style="width:64px;height:64px;background:linear-gradient(135deg,rgba(139,92,246,0.15) 0%,rgba(236,72,153,0.1) 100%);border:2px solid rgba(139,92,246,0.3);
                    border-radius:50%;margin:0 auto 20px;text-align:center;line-height:64px;font-size:28px;">
          💑
        </div>
        <h1 style="margin:0 0 10px;font-size:28px;font-weight:800;color:#111827;line-height:1.2;">
          You've been invited!
        </h1>
        <p style="margin:0 auto;font-size:15px;color:#6B7280;line-height:1.6;max-width:380px;">
          <strong style="color:#111827;">${senderName}</strong> wants to share their finances with you on LifePlan.
          Once linked, you'll both see the same plans, expenses, and budget.
        </p>
      </td>
    </tr>

    ${divider()}

    <!-- What this means -->
    <tr>
      <td style="padding:28px 40px;">
        <p style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:1px;color:#6B7280;text-transform:uppercase;">
          What shared finances means
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${featureRow("📊", "<strong style='color:#111827;'>Same budget view</strong> — both of you see all allocations and expenses")}
          ${featureRow("🎯", "<strong style='color:#111827;'>Shared life plans</strong> — track goals together (home, travel, retirement)")}
          ${featureRow("💸", "<strong style='color:#111827;'>Real-time sync</strong> — any expense or plan update appears for both of you")}
          ${featureRow("🔓", "<strong style='color:#111827;'>Unlink anytime</strong> — you can disconnect at any time from Settings")}
        </table>
      </td>
    </tr>

    ${divider()}

    <!-- CTA -->
    <tr>
      <td style="padding:32px 40px 24px;text-align:center;">
        ${ctaButton("Accept invitation →", acceptUrl)}
        <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;">
          This invitation expires in 7 days. You'll need to create a LifePlan account or log in to accept.
        </p>
      </td>
    </tr>

    <!-- Ignore note -->
    <tr>
      <td style="padding:0 40px 36px;">
        <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">
          If you don't know ${senderName} or didn't expect this invite, you can safely ignore this email.
        </p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: FROM,
    to: invitedEmail,
    subject: `${senderName} invited you to share finances on LifePlan`,
    html,
  });

  if (error) { console.error("[mailer/sendPartnerInviteEmail]", error); throw new Error(error.message); }
}

// ─── 5. Welcome — Google signup ───────────────────────────────────────────────

export async function sendWelcomeGoogleEmail(email: string, name: string) {
  const firstName = name.split(" ")[0];

  const html = wrapper(`
    <!-- Top accent bar -->
    <tr><td style="height:4px;background:linear-gradient(90deg,#1E3A8A 0%,#10B981 100%);"></td></tr>

    <!-- Hero -->
    <tr>
      <td style="padding:48px 40px 32px;text-align:center;">
        <!-- Google G -->
        <div style="width:56px;height:56px;background:#ffffff;border-radius:50%;margin:0 auto 20px;
                    line-height:56px;text-align:center;border:2px solid #E5E7EB;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" style="vertical-align:middle;">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        </div>
        <h1 style="margin:0 0 10px;font-size:28px;font-weight:800;color:#111827;line-height:1.2;">
          Welcome, ${firstName}!
        </h1>
        <p style="margin:0 auto;font-size:15px;color:#6B7280;line-height:1.6;max-width:380px;">
          You've signed in with Google — your LifePlan account is ready and verified. No extra steps needed.
        </p>
      </td>
    </tr>

    ${divider()}

    <!-- Features -->
    <tr>
      <td style="padding:28px 40px;">
        <p style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:1px;color:#6B7280;text-transform:uppercase;">
          Get started in seconds
        </p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${featureRow("🎯", "<strong style='color:#111827;'>Create life plans</strong> — set goals for travel, a car, a house, or a business")}
          ${featureRow("💸", "<strong style='color:#111827;'>Track your spending</strong> — see how daily expenses align with your goals")}
          ${featureRow("📊", "<strong style='color:#111827;'>Allocate income</strong> — divide your income across your plans with intention")}
          ${featureRow("✨", "<strong style='color:#111827;'>Get smart insights</strong> — AI-powered tips to optimize your financial journey")}
        </table>
      </td>
    </tr>

    ${divider()}

    <!-- CTA -->
    <tr>
      <td style="padding:32px 40px 40px;text-align:center;">
        ${ctaButton("Open LifePlan →", `${APP_URL}`)}
        <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;">
          Free plan · Upgrade anytime
        </p>
      </td>
    </tr>
  `);

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Welcome to LifePlan, ${firstName}!`,
    html,
  });

  if (error) { console.error("[mailer/sendWelcomeGoogleEmail]", error); throw new Error(error.message); }
}
