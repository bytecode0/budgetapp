// Run with:  node --import tsx --test server/lib/ai/importMapping.test.ts
//
// The privacy promise of the AI column mapping: whatever a statement holds,
// only column titles and cell FORMATS reach the AI transport.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { shapesFromSample } from "../../../shared/ingest/shapes.js";
import { checkSuggestion, suggestImportMapping } from "./importMapping.js";

const ENV_KEYS = ["AI_PROVIDER", "OPENROUTER_API_KEY", "AI_MODEL_IMPORT_MAPPING", "APP_URL"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let sent: string[];

function stubModel(answer: string) {
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  sent = [];
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test0123456789";
  process.env.AI_MODEL_IMPORT_MAPPING = "test/model";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// An unrecognised statement full of personal data, above and inside the table.
const STATEMENT = [
  ["Extracto de Ana García López", "", "", "", ""],
  ["IBAN ES7620770024003102575766", "", "", "", ""],
  ["Día", "Qué", "Cuánto", "Resto", "Nota"],
  ["29/10/2026", "BIZUM DE JUAN PEREZ", "-42,10", "1.234,56", "ana@example.com"],
  ["30/10/2026", "NOMINA ACME SL", "1.500,00", "2.734,56", "Ref 998877"],
  ["31/10/2026", "MERCADONA VALENCIA 4411", "-12,30", "2.722,26", "DNI 12345678Z"],
];
/** The input the browser would send for STATEMENT's real header row. */
function sampleInput(rows: string[][], headerRow: number) {
  const res = shapesFromSample(rows, headerRow);
  assert.ok("input" in res, JSON.stringify(res));
  return res.input;
}
const RAW_VALUES = STATEMENT.slice(3).flat().concat(STATEMENT[0][0], STATEMENT[1][0]).filter(v => v.trim());

test("only titles and formats reach the transport — never a value of the file", async () => {
  stubModel(JSON.stringify({ date: "Día", amount: "Cuánto", description: ["Qué", "Nota"], balance: "Resto", dateOrder: "dmy", decimal: "," }));
  const result = await suggestImportMapping(sampleInput(STATEMENT, 2));
  assert.deepEqual(result, {
    mapping: { date: "Día", amount: "Cuánto", description: ["Qué", "Nota"], balance: "Resto", dateOrder: "dmy", decimal: "," },
  });
  assert.equal(sent.length, 1);
  const body = sent[0];
  for (const v of RAW_VALUES) {
    assert.ok(!body.includes(v), `raw value reached the AI: ${v}`);
    for (const word of v.split(/[\s,.;:@/-]+/).filter(w => w.length >= 4)) {
      assert.ok(!body.toUpperCase().includes(word.toUpperCase()), `part of a raw value reached the AI: ${word}`);
    }
  }
  // No digits other than the lengths in TEXT(n) and the request's own numbers.
  const prompt = JSON.parse(body).messages[1].content as string;
  assert.ok(!/\d/.test(prompt.replace(/TEXT\(\d+\)/g, "")), prompt);
});

test("a client that sends raw values is refused before any call", async () => {
  stubModel("{}");
  const raw = { headers: ["Día", "Qué", "Cuánto"], shapes: [["29/10/2026", "BIZUM DE JUAN PEREZ", "-42,10"]] };
  assert.equal((await suggestImportMapping(raw) as { error: string }).error, "invalid_input");
  const rawHeader = { headers: ["ES7620770024003102575766", "Cuánto"], headerShapes: ["TEXT(24)", "TEXT(6)"], shapes: [["TEXT(5)", "-#,##"]] };
  assert.equal((await suggestImportMapping(rawHeader) as { error: string }).error, "invalid_input");
  // A data row as the header row (headerless file, or the user picked wrong).
  const dataRow = { headers: ["", "Mercadona", ""], headerShapes: ["EMPTY", "TEXT(9)", "EMPTY"], shapes: [["dd/mm/yyyy", "TEXT(4)", "-#,##"]] };
  assert.equal((await suggestImportMapping(dataRow) as { error: string }).error, "invalid_input");
  assert.deepEqual(shapesFromSample(STATEMENT, 3), { problem: "values" });
  assert.equal(sent.length, 0);
});

test("unavailable or over the rate limit: no call", async () => {
  stubModel("{}");
  const input = sampleInput(STATEMENT, 2);
  assert.deepEqual(await suggestImportMapping(input, () => false), { error: "rate_limited" });
  delete process.env.AI_MODEL_IMPORT_MAPPING;
  assert.deepEqual(await suggestImportMapping(input), { error: "unavailable" });
  assert.equal(sent.length, 0);
});

test("the model's answer is kept only as far as it names real columns", async () => {
  const headers = ["Día", "Qué", "Cuánto", "Resto"];
  assert.equal(checkSuggestion({ date: "Fecha", amount: "Cuánto", description: [] }, headers), null, "invented date column");
  assert.equal(checkSuggestion("nope", headers), null);
  assert.deepEqual(
    checkSuggestion({ date: "día", amount: "Cuánto", debit: "Resto", description: ["Qué", "Invented", "Qué"], purchasesSign: "positive", dateOrder: "xyz", state: "Missing" }, headers),
    { date: "día", amount: "Cuánto", description: ["Qué"] },
  );
  // Prose or fences around the JSON are tolerated; garbage is no suggestion.
  stubModel("Here you go:\n```json\n{\"date\":\"Día\",\"debit\":\"Cuánto\",\"description\":[\"Qué\"]}\n```");
  assert.deepEqual(await suggestImportMapping(sampleInput(STATEMENT, 2)), { mapping: { date: "Día", debit: "Cuánto", description: ["Qué"] } });
  stubModel("I can't help with that");
  assert.deepEqual(await suggestImportMapping(sampleInput(STATEMENT, 2)), { error: "no_suggestion" });
});

test("a provider failure throws (the route answers 502), without the key", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "bad key sk-or-v1-test0123456789" } }), { status: 401 })) as typeof fetch;
  await assert.rejects(suggestImportMapping(sampleInput(STATEMENT, 2)), (e: Error) => !e.message.includes("sk-or-v1-test0123456789"));
});
