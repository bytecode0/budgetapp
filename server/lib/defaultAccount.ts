// The account an expense goes to when the caller didn't pick one (and the
// import picker's first choice in the app mirrors it). In a couple's pool the
// accounts of both partners are listed; defaulting to whichever sorts first
// (often the other partner's "Main") attributes her expense to his money and
// leaves it with him on unlink. So: the caller's own account first, and never
// a card while there is anything else — paying "with" a card turns the expense
// into card debt (server/lib/debtBalance.ts). Unit-tested in defaultAccount.test.ts.

export interface AccountChoice {
  id: string;
  ownerUserId: string;
  type: string;
  isArchived: boolean;
  sortOrder: number;
}

/** The default account for `authUserId`, or null when the pool has none open. */
export function pickDefaultAccount(accounts: AccountChoice[], authUserId: string): string | null {
  const open = accounts.filter(a => !a.isArchived).sort((a, b) => a.sortOrder - b.sortOrder);
  const rank = (a: AccountChoice) => (a.type === "card" ? 2 : 0) + (a.ownerUserId === authUserId ? 0 : 1);
  const best = open.reduce<AccountChoice | null>((b, a) => (b === null || rank(a) < rank(b) ? a : b), null);
  return best?.id ?? null;
}
