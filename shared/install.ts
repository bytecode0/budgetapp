// Installing Remanso on the phone (LPBETA-11). Pure: the app passes in what
// the browser reports.

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
