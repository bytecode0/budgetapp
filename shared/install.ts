// Installing Remanso on the phone (LPBETA-11) and the first screen a visitor
// without a session sees. Pure: the app passes in what the browser reports.

/** Which install hint to show: iPhone/iPad instructions (Safari has no install
 *  event), the browser's own install prompt (Android), or none. */
export type InstallHint = "ios" | "prompt" | null;

export interface InstallEnv {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS reports itself as a Mac with touch. */
  maxTouchPoints: number;
  /** Already running as the installed app. */
  standalone: boolean;
  /** Closed on this device before. */
  dismissed: boolean;
  /** A `beforeinstallprompt` event is waiting to be used. */
  canPrompt: boolean;
}

export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function isMobile(userAgent: string, maxTouchPoints: number): boolean {
  return isIOS(userAgent, maxTouchPoints) || /Android|Mobi/.test(userAgent);
}

export function installHint(env: InstallEnv): InstallHint {
  if (env.standalone || env.dismissed) return null;
  if (isIOS(env.userAgent, env.maxTouchPoints)) return "ios";
  // Desktop browsers fire the event too; the hint is about the phone.
  if (env.canPrompt && isMobile(env.userAgent, env.maxTouchPoints)) return "prompt";
  return null;
}

export interface AuthEntry {
  pathname: string;
  search: string;
  /** A partner invite is pending (?invite= or saved before an OAuth redirect). */
  hasInvite: boolean;
  standalone: boolean;
  /** Someone has signed in on this device before: they know the app. */
  signedInBefore?: boolean;
}

/** Whether a visitor without a session starts on the public welcome page
 *  rather than the sign-in form. Not when they are mid-flow (Google callback or
 *  error, partner invite) or opened the installed app: they already know it. */
export function startsOnLanding(entry: AuthEntry): boolean {
  if (entry.standalone || entry.hasInvite || entry.signedInBefore) return false;
  if (entry.pathname === "/auth/google/callback") return false;
  const params = new URLSearchParams(entry.search);
  // Back from the bank, or the "renew your connection" email: an existing user.
  return !params.has("error") && !params.has("bankToken") && !params.has("open");
}
