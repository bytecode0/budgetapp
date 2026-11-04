// Where to go back after the bank's consent page (LPBETA-04). The bank
// redirects to the app's root, so the screen the user started from is kept in
// sessionStorage across that round trip (same tab, same origin). Only a
// per-tab convenience: when storage is unavailable the flow ends in Accounts,
// as before.
const KEY = 'lp.bankReturnScreen';

export type BankReturnScreen = 'activity' | 'home';

export function rememberBankReturn(screen: BankReturnScreen | undefined): void {
  try {
    if (screen) sessionStorage.setItem(KEY, screen);
    else sessionStorage.removeItem(KEY);
  } catch { /* storage blocked: fall back to Accounts */ }
}

/** Reads and forgets the screen to return to. */
export function takeBankReturn(): BankReturnScreen | null {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return value === 'activity' || value === 'home' ? value : null;
  } catch {
    return null;
  }
}
