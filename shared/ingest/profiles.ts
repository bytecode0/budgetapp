// Bank profiles: a known export layout → the ColumnMapping that reads it.
// Pure; runs in Node and browser. A profile is recognised by its exact header
// set, so it never steals a file another profile (or the user's own saved
// mapping) reads better. Add a bank: one entry here + an anonymised fixture
// and a test in server/lib/ingest/profiles.test.ts.
import { normHeader } from "./columns.js";
import type { ColumnMapping, StatementSource } from "./types.js";

export interface BankProfile {
  id: Extract<StatementSource, "bbva" | "revolut">;
  /** Headers that must ALL be present in one row (compared normalised). */
  headers: string[];
  mapping: ColumnMapping;
}

export const PROFILES: BankProfile[] = [
  {
    // BBVA — current account, "Últimos movimientos" .xlsx from the web/app.
    // Title rows above; header "F.Valor, Fecha, Concepto, Movimiento, Importe,
    // Divisa, Disponible, Divisa, Observaciones"; newest first; dates as
    // dd/mm/yyyy text; Importe/Disponible as numbers. Concepto is often a
    // generic label ("Bizum", "Transferencia realizada"): the meaning lives in
    // Movimiento/Observaciones, kept as details. Fixture: server/lib/ingest/fixtures/makeFixtures.ts.
    id: "bbva",
    headers: ["F.Valor", "Fecha", "Concepto", "Movimiento", "Importe", "Disponible"],
    mapping: {
      date: "Fecha",
      amount: "Importe",
      description: ["Concepto", "Movimiento", "Observaciones"],
      balance: "Disponible",
      currency: "Divisa",
      dateOrder: "dmy",
    },
  },
  {
    // Revolut — current account CSV ("Statement" → Excel/CSV).
    // PENDING VALIDATION WITH A REAL FILE: built from Revolut's documented
    // export columns, not from a real export yet (server/lib/ingest/fixtures/makeFixtures.ts
    // is synthetic). Decisions (docs/plan-deudas-y-onboarding.md §4.7):
    //  - only COMPLETED rows are imported; PENDING, REVERTED, DECLINED, FAILED
    //    are skipped and listed (a pending row comes back as COMPLETED in the
    //    next export, with the same fingerprint);
    //  - Fee is a separate column and becomes its OWN expense row next to the
    //    movement (classify.ts), so the purchase keeps its real amount and
    //    category and the fee is visible;
    //  - Started Date is the operation date (when the card was used);
    //  - a row in another currency than the account's is flagged, not converted.
    id: "revolut",
    headers: ["Type", "Started Date", "Description", "Amount", "Fee", "Currency", "State"],
    mapping: {
      date: "Started Date",
      amount: "Amount",
      description: ["Description"],
      balance: "Balance",
      currency: "Currency",
      state: "State",
      fee: "Fee",
      dateOrder: "ymd",
      decimal: ".",
    },
  },
];

/** The profile whose headers are all in some row of the first 30, with that row. */
export function matchProfile(grid: unknown[][]): { profile: BankProfile; headerRow: number } | null {
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const cells = new Set((grid[r] ?? []).map(normHeader));
    for (const profile of PROFILES) {
      if (profile.headers.every(h => cells.has(normHeader(h)))) return { profile, headerRow: r };
    }
  }
  return null;
}
