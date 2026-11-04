// Browser side of installing Remanso (LPBETA-11); the decision of what to show
// is in shared/install.ts. Chrome on Android fires `beforeinstallprompt` once,
// soon after load and before the signed-in app has mounted, so main.tsx calls
// captureInstallPrompt() at startup and keeps the event here until the install
// hint uses it.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
  interface Navigator {
    /** iOS Safari: true when opened from the home screen. */
    standalone?: boolean;
  }
}

let pending: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // our hint offers it instead of the browser's mini-bar
    pending = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    pending = null;
    notify();
  });
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasInstallPrompt(): boolean {
  return pending !== null;
}

/** Opens the browser's install dialog; true if the person installed. The event
 *  can be used only once, so it is dropped either way. */
export async function promptInstall(): Promise<boolean> {
  const event = pending;
  if (!event) return false;
  pending = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === 'accepted';
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || navigator.standalone === true;
}

const DISMISSED_KEY = 'remanso-install-hint-dismissed';

export function installHintDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage blocked: the hint stays closed for this visit only.
  }
}

// "Someone has signed in on this device": after that, the public welcome page
// is skipped (logout, an expired session). A per-device convenience only.
const SIGNED_IN_KEY = 'remanso-signed-in-before';

export function signedInBefore(): boolean {
  try { return localStorage.getItem(SIGNED_IN_KEY) === '1'; } catch { return false; }
}

export function markSignedIn(): void {
  try { localStorage.setItem(SIGNED_IN_KEY, '1'); } catch { /* storage blocked */ }
}
