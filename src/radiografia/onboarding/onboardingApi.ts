// Thin fetch wrapper for /api/radiografia/*. Every call sends credentials —
// the anon cookie authorizes a not-yet-confirmed profile, and once an
// accessToken exists (post email-verify) it's sent as a Bearer header, which
// resolveProfile() on the server prefers over the cookie (see F3 route
// comments) — that's what lets a returning tab/device without the cookie
// resume a confirmed profile.
export interface OnboardingProfile {
  profileId: string;
  onboardingStep: string | null;
  currency: string;
  incomeType: string;
  emailVerified: boolean;
  email?: string | null;
  stageId?: string | null;
  // Server-side evidence that /profile/extracto ever succeeded for this
  // profile — the authority for whether resuming can land past the upload
  // step. Never trust the client's own resume-position for this: it's lost
  // on a device switch and could predate the statement becoming mandatory.
  hasExtracto: boolean;
  // Radiografia.id — the permanent web report's token. Present once the
  // email is confirmed, so a page refresh at the result step still has a
  // working link to the rich report, not just the response of the one-time
  // /email/verify call.
  reportToken?: string | null;
}

export interface StageStatus {
  stageId: string | null;
  branchId: string | null;
  classifiable: boolean;
}

interface ApiResult<T> {
  data?: T;
  error?: string;
}

async function call<T>(path: string, init: RequestInit, accessToken: string | null): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/api/radiografia${path}`, { ...init, headers, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: body.error ?? 'network' };
  return body as ApiResult<T>;
}

export function bootstrapProfile(accessToken: string | null) {
  return call<OnboardingProfile>('/profile', { method: 'POST', body: JSON.stringify({}) }, accessToken);
}

export function fetchProfile(accessToken: string | null) {
  return call<OnboardingProfile>('/profile', { method: 'GET' }, accessToken);
}

export function saveStep(step: string, accessToken: string | null) {
  return call<{ onboardingStep: string }>('/profile/step', { method: 'PATCH', body: JSON.stringify({ step }) }, accessToken);
}

// `consentReport` is the explicit, never-pre-checked GDPR consent for sending
// the report. The server refuses the request without it — the box is the legal
// basis for the send, not a UI formality.
export function requestEmailCode(email: string, consentReport: boolean, accessToken: string | null) {
  return call<{ sentTo: string; expiresInSeconds: number }>(
    '/email/request',
    { method: 'POST', body: JSON.stringify({ email, consentReport }) },
    accessToken,
  );
}

// `names` are the merchant names read from the statement, held in
// sessionStorage since the moment it was analyzed — handed over here, at the
// one moment they're useful (the confirmation email), and never before or
// after. The server never writes them anywhere (see InsightNames in
// server/lib/radiografia/report.ts).
export function verifyEmailCode(code: string, names: InsightNames | null, accessToken: string | null) {
  return call<{ profileId: string; accessToken: string; email: string; reportSent: boolean; reportToken: string | null }>(
    '/email/verify',
    { method: 'POST', body: JSON.stringify({ code, names }) },
    accessToken,
  );
}

export function resendReport(accessToken: string | null) {
  return call<{ delivered: boolean; reportToken: string | null }>('/report/resend', { method: 'POST', body: JSON.stringify({}) }, accessToken);
}

export interface FieldInput { key: string; valueCents: number }
export interface DebtInput { kind: string; monthlyPayment: number; outstandingBalance?: number; apr?: number }

export function saveFields(
  payload: { fields: FieldInput[]; debts: DebtInput[]; debtsNone: boolean },
  accessToken: string | null,
) {
  return call<{ completeness: { pct: number; missing: string[]; classifiable: boolean }; stage: StageStatus }>(
    '/profile/fields',
    { method: 'POST', body: JSON.stringify(payload) },
    accessToken,
  );
}

// File → base64 (strips the "data:...;base64," prefix), same approach as useXray.ts.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface ExtractoDetected {
  months: number;
  transactionCount: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  savingMonthly: number;
  investmentMonthly: number;
  accountBalance: number | null;
  debtsCount: number;
}

// Merchant names for the small-purchases and subscriptions the statement
// detected. Lives only in sessionStorage between here and email/verify — see
// InsightNames in server/lib/radiografia/report.ts for the full reasoning.
export interface InsightNames {
  ant: { merchant: string; count: number }[];
  recurring: { merchant: string }[];
}

export async function uploadExtracto(files: File[], accessToken: string | null) {
  const uploaded = await Promise.all(files.map(async f => ({ filename: f.name, dataBase64: await fileToBase64(f) })));
  return call<{
    completeness: { pct: number; missing: string[]; classifiable: boolean };
    stage: StageStatus;
    detected: ExtractoDetected;
    insightNames: InsightNames;
  }>(
    '/profile/extracto',
    { method: 'POST', body: JSON.stringify({ files: uploaded }) },
    accessToken,
  );
}
