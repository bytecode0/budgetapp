// OFX / QFX → rows. Pure; runs in Node and browser.
//
// Both flavours: OFX 1.x (SGML — leaf elements have no closing tag) and 2.x
// (XML). Each <STMTTRN> block is one movement: DTPOSTED (yyyymmdd…), TRNAMT
// (signed from the holder's view, also for credit-card statements: a purchase
// is negative), FITID (the bank's id → externalRef), NAME / MEMO. The
// statement's CURDEF is the currency. A credit-card statement
// (CREDITCARDMSGSRSV1 / CCSTMTRS) is reported so the caller can check it's
// being imported into a card.
import { parseDay } from "../dates.js";
import { parseAmountCents } from "../numbers.js";
import type { NormalizedRow, ReadResult } from "../types.js";

export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 2000).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX>");
}

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Value of a leaf element inside a block: "<TAG>value" up to the next tag or line end. */
function leaf(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return m ? decodeEntities(m[1].trim()) : null;
}

export function readOfx(text: string): ReadResult & { isCreditCard: boolean } {
  const rows: NormalizedRow[] = [];
  const skipped: ReadResult["skipped"] = [];
  const currency = leaf(text, "CURDEF");
  const isCreditCard = /<CCSTMTRS>/i.test(text);

  const blocks = text.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0]);
  blocks.forEach((block, rowIndex) => {
    const date = parseDay(leaf(block, "DTPOSTED") ?? "", "ymd");
    // TRNAMT is always "." decimal per the spec, sometimes "," from sloppy exporters.
    const rawAmount = leaf(block, "TRNAMT") ?? "";
    const amountCents = parseAmountCents(rawAmount, rawAmount.includes(",") && !rawAmount.includes(".") ? "," : ".");
    if (!date || amountCents === null) { skipped.push({ rowIndex, reason: !date ? "no_date" : "no_amount" }); return; }
    const name = leaf(block, "NAME") ?? "";
    const memo = leaf(block, "MEMO") ?? "";
    rows.push({
      rowIndex,
      date,
      amountCents,
      description: name || memo,
      details: name && memo && memo !== name ? memo : undefined,
      externalRef: leaf(block, "FITID") || null,
      currency,
      balanceCents: null,
    });
  });
  return { rows, skipped, source: "ofx", currency, isCreditCard };
}
