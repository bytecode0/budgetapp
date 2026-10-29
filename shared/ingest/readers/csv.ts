// CSV → grid of strings. Pure; runs in Node and browser.
//
// RFC 4180 quoting (separators, line breaks and "" inside quoted fields), the
// separators Spanish and foreign banks use (; , tab |), and CRLF/LF/CR line
// ends. The separator is chosen by parsing the first lines with each candidate
// and keeping the one that gives the most lines with the same field count —
// title/metadata rows above the table and decimal commas don't fool it.

export type CsvDelimiter = ";" | "," | "\t" | "|";
const CANDIDATES: CsvDelimiter[] = [";", ",", "\t", "|"];

/** Splits CSV text into rows of fields with the given delimiter. */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false; // quotes only open a field at its start

  const endField = () => { row.push(fieldStarted ? field : field.trim()); field = ""; fieldStarted = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === "" && !fieldStarted) { inQuotes = true; fieldStarted = true; field = ""; continue; }
    if (c === delimiter) { endField(); continue; }
    if (c === "\r") { if (text[i + 1] === "\n") i++; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    if (fieldStarted && !inQuotes) { if (c.trim()) field += c; continue; } // text after a closing quote
    field += c;
  }
  if (field !== "" || row.length > 0 || fieldStarted) endRow();
  // Drop fully empty lines; keep positions irrelevant (rowIndex is per data row).
  return rows.filter(r => r.some(f => f.trim() !== ""));
}

/** Picks the delimiter that makes the first lines most consistently tabular. */
export function detectDelimiter(text: string): CsvDelimiter {
  const head = text.split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 15).join("\n");
  let best: CsvDelimiter = ";";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = parseCsv(head, d).map(r => r.length).filter(n => n > 1);
    if (counts.length === 0) continue;
    const freq = new Map<number, number>();
    for (const n of counts) freq.set(n, (freq.get(n) ?? 0) + 1);
    // Lines sharing the modal width, then the width itself as a tie-break.
    const [width, lines] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = lines * 1000 + width;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function readCsv(text: string): string[][] {
  return parseCsv(text, detectDelimiter(text));
}
