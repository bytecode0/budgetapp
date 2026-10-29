// Bytes → text with the encoding banks actually use. Pure; runs in Node and
// browser (TextDecoder for UTF-8/UTF-16, which every runtime ships; Latin-1 /
// Windows-1252 decoded by hand so it doesn't depend on ICU data).
//
// Order: a BOM decides (UTF-8, UTF-16 LE/BE); UTF-16 without BOM is spotted by
// its zero bytes; otherwise strict UTF-8, and if that fails it's Windows-1252
// (the superset of Latin-1 that Spanish bank exports really are: "€" is 0x80).

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

// 0x80–0x9F in Windows-1252 (undefined slots map to the C1 control itself).
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

function decodeCp1252(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    out += String.fromCharCode(...Array.from(chunk, b => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b)));
  }
  return out;
}

function decodeUtf16be(bytes: Uint8Array): string {
  const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
  for (let i = 0; i + 1 < bytes.length; i += 2) { swapped[i] = bytes[i + 1]; swapped[i + 1] = bytes[i]; }
  return new TextDecoder("utf-16le").decode(swapped);
}

export function detectEncoding(bytes: Uint8Array): TextEncodingName {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // No BOM: ASCII text in UTF-16 has a zero in every other byte.
  const sample = bytes.subarray(0, 512);
  let evenZeros = 0, oddZeros = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? oddZeros++ : evenZeros++);
  const half = sample.length / 2;
  if (half >= 4 && oddZeros > half * 0.6 && evenZeros < half * 0.1) return "utf-16le";
  if (half >= 4 && evenZeros > half * 0.6 && oddZeros < half * 0.1) return "utf-16be";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

/** Decodes a statement's bytes to text, dropping any BOM. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncodingName } {
  const encoding = detectEncoding(bytes);
  let text: string;
  switch (encoding) {
    case "utf-8": text = new TextDecoder("utf-8").decode(bytes); break;
    case "utf-16le": text = new TextDecoder("utf-16le").decode(bytes); break;
    case "utf-16be": text = decodeUtf16be(bytes); break;
    default: text = decodeCp1252(bytes);
  }
  return { text: text.replace(/^﻿/, ""), encoding };
}
