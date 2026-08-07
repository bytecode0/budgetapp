// Live contract check against GoCardless Bank Account Data.
//
// Why this exists: server/lib/banking/gocardless.ts maps a specific set of
// field names (transactionAmount, remittanceInformationUnstructured,
// balanceType: "interimAvailable", requisition status "LN", …) that were taken
// from the documented API and never verified against a real response. This
// script talks to the provider with plain fetch — deliberately NOT through our
// client — and reports, field by field, whether what arrives is what the client
// expects. Any mismatch here is a bug in gocardless.ts, found in seconds
// instead of halfway through the consent flow in the browser.
//
// Needs GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY in .env. Touches no DB.
//
//   Stage 1 — credentials + institutions (no consent needed):
//     npx tsx server/scripts/checkGocardless.ts
//
//   Stage 2 — start a sandbox consent, prints a URL to open in the browser:
//     npx tsx server/scripts/checkGocardless.ts --connect
//
//   Stage 3 — after consenting, dump the real shapes for that requisition:
//     npx tsx server/scripts/checkGocardless.ts <requisitionId>
import "dotenv/config";

const BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";
const SANDBOX_INSTITUTION = "SANDBOXFINANCE_SFIN0000";

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  · ${m}`);
const head = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

/** Reports whether `obj` carries the field our client reads. */
function expectField(obj: any, path: string, usedBy: string): boolean {
  let value: any = obj;
  for (const key of path.split(".")) {
    value = value == null ? undefined : value[key];
  }
  if (value === undefined || value === null) {
    bad(`falta \`${path}\` — lo lee ${usedBy}`);
    return false;
  }
  ok(`\`${path}\` = ${JSON.stringify(value)}`);
  return true;
}

async function getToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret_id: process.env.GOCARDLESS_SECRET_ID,
      secret_key: process.env.GOCARDLESS_SECRET_KEY,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`auth ${res.status}: ${body}`);
  const data = JSON.parse(body) as { access: string; access_expires: number };
  if (!data.access) throw new Error(`auth OK pero sin campo \`access\`: ${body}`);
  ok(`token obtenido, caduca en ${data.access_expires}s`);
  return data.access;
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} en ${path}: ${body}`);
  return JSON.parse(body) as T;
}

(async () => {
  if (!process.env.GOCARDLESS_SECRET_ID || !process.env.GOCARDLESS_SECRET_KEY) {
    bad("Falta GOCARDLESS_SECRET_ID y/o GOCARDLESS_SECRET_KEY en .env");
    process.exit(1);
  }

  head("1. Autenticación (POST /token/new/)");
  const token = await getToken();

  const arg = process.argv[2];

  head("2. Instituciones (GET /institutions/?country=ES)");
  const institutions = await api<any[]>(token, "/institutions/?country=ES");
  if (!Array.isArray(institutions)) {
    bad(`se esperaba un array; llegó ${typeof institutions}. listInstitutions() lo asume array.`);
  } else {
    ok(`${institutions.length} instituciones para ES`);
    const sample = institutions[0];
    expectField(sample, "id", "listInstitutions()");
    expectField(sample, "name", "listInstitutions()");
    if (sample?.logo === undefined) info("`logo` ausente — es opcional, la UI cae a un placeholder");
    else ok("`logo` presente");

    for (const b of ["BBVA", "SANTANDER", "CAIXA", "ING", "SABADELL"]) {
      const hit = institutions.find(i => String(i.id).toUpperCase().includes(b));
      hit ? ok(`${b} disponible → ${hit.id}`) : bad(`${b} NO aparece en la lista de ES`);
    }
    const sandbox = institutions.find(i => i.id === SANDBOX_INSTITUTION);
    sandbox
      ? ok(`sandbox disponible → ${SANDBOX_INSTITUTION}`)
      : info(`${SANDBOX_INSTITUTION} no está en la lista de ES (normal: suele no listarse, pero sí funciona)`);
  }

  // ── Stage 2: abrir un consentimiento de sandbox ──────────────────────────
  if (arg === "--connect") {
    head("3. Crear requisition de sandbox (POST /requisitions/)");
    const redirect = process.env.GOCARDLESS_REDIRECT_URL ?? "http://localhost:3002/api/banking/callback";
    const req = await api<any>(token, "/requisitions/", {
      method: "POST",
      body: JSON.stringify({
        institution_id: SANDBOX_INSTITUTION,
        redirect,
        reference: `contract-check-${Date.now()}`,
        user_language: "ES",
      }),
    });
    expectField(req, "id", "createConnection()");
    expectField(req, "link", "createConnection()");
    console.log(`\n  Abre esta URL, completa el consentimiento de sandbox y vuelve:\n\n    ${req.link}\n`);
    console.log(`  Después ejecuta:\n\n    npx tsx server/scripts/checkGocardless.ts ${req.id}\n`);
    return;
  }

  if (!arg) {
    head("Listo — credenciales e instituciones verificadas.");
    console.log("  Siguiente: npx tsx server/scripts/checkGocardless.ts --connect\n");
    return;
  }

  // ── Stage 3: volcar las formas reales de una requisition ya consentida ──
  head(`3. Requisition (GET /requisitions/${arg}/)`);
  const requisition = await api<any>(token, `/requisitions/${arg}/`);
  expectField(requisition, "status", "getConnectionAccounts()");
  info(`status = ${requisition.status} — el cliente considera vinculado SOLO si es exactamente "LN"`);
  if (requisition.status !== "LN") {
    bad(`status no es "LN": el consentimiento no está completo, o el provider usa otro código`);
  }
  if (!Array.isArray(requisition.accounts) || requisition.accounts.length === 0) {
    bad("`accounts` vacío o ausente — sin cuentas no hay nada que mapear");
    return;
  }
  ok(`${requisition.accounts.length} cuenta(s): ${requisition.accounts.join(", ")}`);

  for (const accountId of requisition.accounts) {
    head(`4. Cuenta ${accountId}`);

    // getConnectionAccounts() hoy NO llama a este endpoint: devuelve solo
    // {id, currency:"EUR"}, sin iban ni nombre. Lo pedimos aquí para ver qué
    // se está perdiendo la pantalla de mapeo de cuentas.
    try {
      const details = await api<any>(token, `/accounts/${accountId}/`);
      info(`detalles disponibles pero NO usados por el cliente: ${JSON.stringify(details)}`);
    } catch (e) {
      info(`GET /accounts/${accountId}/ falló: ${(e as Error).message}`);
    }

    console.log("\n  Balances (GET /balances/)");
    const balances = await api<any>(token, `/accounts/${accountId}/balances/`);
    const list = balances.balances ?? [];
    if (!Array.isArray(list) || list.length === 0) {
      bad("`balances` vacío — getAccountBalance() devolvería null");
    } else {
      info(`tipos: ${list.map((b: any) => b.balanceType).join(", ")}`);
      const preferred = list.find((b: any) => b.balanceType === "interimAvailable") ?? list[0];
      if (!list.some((b: any) => b.balanceType === "interimAvailable")) {
        info(`sin "interimAvailable" → cae al primero (${preferred.balanceType}); revisa si es el correcto`);
      }
      expectField(preferred, "balanceAmount.amount", "getAccountBalance()");
      expectField(preferred, "balanceAmount.currency", "getAccountBalance()");
    }

    console.log("\n  Transacciones (GET /transactions/)");
    const txns = await api<any>(token, `/accounts/${accountId}/transactions/`);
    const booked = txns.transactions?.booked;
    if (!Array.isArray(booked)) {
      bad("falta `transactions.booked` — getAccountTransactions() devolvería []");
      info(`llegó: ${JSON.stringify(Object.keys(txns.transactions ?? txns))}`);
      continue;
    }
    ok(`${booked.length} transacciones booked`);
    if (txns.transactions?.pending?.length) {
      info(`${txns.transactions.pending.length} pending — el cliente las IGNORA a propósito`);
    }
    const t = booked[0];
    if (!t) { info("sin transacciones que inspeccionar"); continue; }

    console.log(`\n  Primera transacción, cruda:\n  ${JSON.stringify(t)}\n`);
    const hasId = t.transactionId ?? t.internalTransactionId;
    hasId
      ? ok(`id de dedupe = ${hasId}`)
      : bad("ni `transactionId` ni `internalTransactionId` → la fila se descarta (¡y se pierde!)");
    const hasDate = t.bookingDate ?? t.valueDate;
    hasDate ? ok(`fecha = ${hasDate}`) : bad("ni `bookingDate` ni `valueDate` → la fila se descarta");
    expectField(t, "transactionAmount.amount", "getAccountTransactions()");
    expectField(t, "transactionAmount.currency", "getAccountTransactions()");
    const desc = t.remittanceInformationUnstructured || t.creditorName || t.debtorName;
    desc
      ? ok(`descripción = "${desc}"`)
      : bad("sin remittanceInformationUnstructured/creditorName/debtorName → descripción vacía, la categorización no tendrá nada que leer");

    const dropped = booked.filter((x: any) => !(x.transactionId ?? x.internalTransactionId) || !(x.bookingDate ?? x.valueDate));
    dropped.length
      ? bad(`${dropped.length}/${booked.length} transacciones se descartarían por falta de id o fecha`)
      : ok("ninguna transacción se descartaría");
  }

  console.log("");
})().catch(e => { console.error(`\n\x1b[31m${e.message}\x1b[0m\n`); process.exit(1); });
