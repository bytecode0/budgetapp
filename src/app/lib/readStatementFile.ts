// Reads a statement file IN THE BROWSER with the same pure readers the server
// uses (shared/ingest/), so only the rows are posted (decision O: no file in
// the request body, no 4.5 MB limit on Vercel). The readers (and the `xlsx`
// package) load on demand, only when someone imports.
import type { StatementErrorCode, StatementSample } from '../../../shared/ingest/read';
import type { ColumnMapping, ReadResult } from '../../../shared/ingest/types';

/** Files the server may still read itself when the browser can't: the
 *  base64 body must stay under Vercel's 4.5 MB request limit. */
export const SERVER_READ_MAX_BYTES = 3 * 1024 * 1024;

export type BrowserRead =
  | { ok: true; result: ReadResult }
  /** The file was read and isn't usable as is (codes as the server's 422). */
  | { ok: false; code: StatementErrorCode; sample?: StatementSample[] }
  /** The reader itself failed (old browser, chunk not loaded…). */
  | { ok: false; code: 'reader_failed' };

export async function readStatementFile(bytes: Uint8Array, filename: string, mapping: ColumnMapping | null): Promise<BrowserRead> {
  let mod: typeof import('../../../shared/ingest/read');
  try {
    mod = await import('../../../shared/ingest/read');
  } catch {
    return { ok: false, code: 'reader_failed' };
  }
  try {
    return { ok: true, result: mod.readStatement(bytes, filename, { mapping }) };
  } catch (e) {
    if (e instanceof mod.StatementReadError) return { ok: false, code: e.code, ...(e.sample ? { sample: e.sample } : {}) };
    return { ok: false, code: 'reader_failed' };
  }
}
