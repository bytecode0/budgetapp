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

export function requestEmailCode(email: string, accessToken: string | null) {
  return call<{ sentTo: string; expiresInSeconds: number }>(
    '/email/request',
    { method: 'POST', body: JSON.stringify({ email }) },
    accessToken,
  );
}

export function verifyEmailCode(code: string, accessToken: string | null) {
  return call<{ profileId: string; accessToken: string; email: string }>(
    '/email/verify',
    { method: 'POST', body: JSON.stringify({ code }) },
    accessToken,
  );
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
