// Coverage + contract check against Tink (Visa), before writing an adapter.
//
// Answers the only question that decides the provider: are the Spanish banks
// and Revolut actually there? And, secondarily, what does a provider record
// look like so `tink.ts` can map it onto BankInstitution.
//
// Tink's docs are a client-rendered SPA, so the exact providers endpoint could
// not be confirmed from source. This script therefore TRIES several documented
// and likely variants and reports which one answers — discovery, not guesswork.
// Whatever it finds is what the adapter should use.
//
// Credentials come from .env and are never printed:
//   TINK_CLIENT_ID=...
//   TINK_CLIENT_SECRET=...
//
//   npx tsx server/scripts/checkTink.ts
import "dotenv/config";

const BASE_URL = "https://api.tink.com";

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  · ${m}`);
const head = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

// Requested widest-first: the granted `scope` in the response tells us what
// this app is actually allowed to do, which is itself a useful diagnostic.
const SCOPE_ATTEMPTS = [
  "provider:read,authorization:grant,user:create",
  "provider:read",
  "authorization:grant,user:create",
];

async function getClientToken(): Promise<string> {
  const errors: string[] = [];
  for (const scope of SCOPE_ATTEMPTS) {
    const res = await fetch(`${BASE_URL}/api/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.TINK_CLIENT_ID!,
        client_secret: process.env.TINK_CLIENT_SECRET!,
        grant_type: "client_credentials",
        scope,
      }),
    });
    const body = await res.text();
    if (res.ok) {
      const data = JSON.parse(body) as { access_token: string; expires_in: number; scope?: string };
      ok(`token obtenido (caduca en ${data.expires_in}s)`);
      info(`scopes concedidos: ${data.scope ?? "(no devueltos)"}`);
      if (scope !== SCOPE_ATTEMPTS[0]) {
        info(`nota: falló el scope más amplio, se usó "${scope}" — la app tiene permisos limitados`);
      }
      return data.access_token;
    }
    errors.push(`scope="${scope}" → ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error(`ningún scope funcionó:\n    ${errors.join("\n    ")}`);
}

/** Endpoint variants to probe, most likely first. An empty 200 is NOT an
 *  answer — Tink returns one when the app has no providers enabled yet, or
 *  when test providers must be requested explicitly — so keep probing. */
const PROVIDER_ENDPOINTS = [
  "/api/v1/providers?market=ES",
  "/api/v1/providers?market=ES&includeTestProviders=true",
  "/api/v1/providers?market=ES&capability=TRANSACTIONS",
  "/api/v1/providers?market=ES&capability=CHECKING_ACCOUNTS&includeTestProviders=true",
  "/api/v1/providers?includeTestProviders=true",
  "/api/v1/providers/ES",
  "/api/v1/providers/list?market=ES",
  "/api/v1/providers",
];

interface Probe { path: string; providers: any[] }

async function findProviders(token: string): Promise<Probe | null> {
  let empty: Probe | null = null;

  for (const path of PROVIDER_ENDPOINTS) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    if (!res.ok) {
      info(`${path} → ${res.status} ${body.replace(/\s+/g, " ").slice(0, 130)}`);
      continue;
    }
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { info(`${path} → 200 pero no es JSON`); continue; }
    const providers = Array.isArray(parsed)
      ? parsed
      : parsed.providers ?? parsed.data ?? parsed.items ?? null;
    if (!Array.isArray(providers)) {
      info(`${path} → 200 sin array reconocible; claves: ${Object.keys(parsed).join(", ")}`);
      info(`   cuerpo: ${body.replace(/\s+/g, " ").slice(0, 200)}`);
      continue;
    }
    if (providers.length === 0) {
      info(`${path} → 200 pero VACÍO`);
      info(`   cuerpo crudo: ${body.replace(/\s+/g, " ").slice(0, 200)}`);
      empty ??= { path, providers };
      continue; // an empty catalogue answers nothing — try the next variant
    }
    ok(`${path} → 200, ${providers.length} proveedores`);
    return { path, providers };
  }

  if (empty) {
    bad("Todas las variantes que responden 200 devuelven una lista VACÍA.");
    info("Interpretación: el endpoint funciona y tu token vale, pero tu app no tiene");
    info("ningún proveedor habilitado — estado típico de una app de Console sin activar.");
  }
  return null;
}

// ── Permanent-user flow ────────────────────────────────────────────────────
// Tink's client token only bootstraps: it creates users and mints authorization
// grants. Everything else needs a USER access token — which is exactly what the
// 403 on /providers means by "provided token type CLIENT". The two scopes this
// app was granted (user:create, authorization:grant) are precisely the ones
// this flow needs, so it's worth trying before touching Console.

async function post(token: string, path: string, body: Record<string, string>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

// Tink's OAuth endpoints take form-encoded bodies, unlike /user/create which
// takes JSON. Sending JSON here returns 400 "Failed to deserialize request
// body" — which looks like a permissions problem but isn't one.
async function postForm(token: string, path: string, body: Record<string, string>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function createPermanentUser(clientToken: string): Promise<string | null> {
  const r = await post(clientToken, "/api/v1/user/create", { market: "ES", locale: "es_ES" });
  if (!r.ok) { bad(`POST /api/v1/user/create → ${r.status} ${r.text.slice(0, 200)}`); return null; }
  const id = (JSON.parse(r.text) as any).user_id ?? (JSON.parse(r.text) as any).userId;
  id ? ok(`usuario permanente creado (${String(id).slice(0, 8)}…)`) : bad(`sin user_id en: ${r.text.slice(0, 200)}`);
  return id ?? null;
}

// `provider:read` came back as "Scopes not valid for this client" while the
// others were never named as invalid — so the data scopes are probably fine and
// only the provider catalogue is closed. Ordered widest-first WITHOUT it, so a
// success tells us exactly which set this client really holds.
const GRANT_SCOPES = [
  "accounts:read,transactions:read,credentials:read,user:read",
  "accounts:read,transactions:read",
  "accounts:read",
  "credentials:read",
];

// Kept so we can build a Tink Link URL even when the providers API stays shut:
// Tink's own bank picker renders the real ES catalogue, which answers the
// coverage question visually without needing `provider:read` at all.
let lastGrantCode: string | null = null;

async function getUserToken(clientToken: string, userId: string): Promise<string | null> {
  for (const scope of GRANT_SCOPES) {
    const grant = await postForm(clientToken, "/api/v1/oauth/authorization-grant", { user_id: userId, scope });
    if (!grant.ok) {
      const why = grant.status === 403 ? " (403 = scope NO autorizado para esta app)"
        : grant.status === 400 ? " (400 = petición mal formada, no es un problema de permisos)" : "";
      info(`authorization-grant scope="${scope}" → ${grant.status}${why} ${grant.text.replace(/\s+/g, " ").slice(0, 180)}`);
      continue;
    }
    const code = (JSON.parse(grant.text) as any).code;
    if (!code) { info(`grant sin \`code\`: ${grant.text.slice(0, 160)}`); continue; }
    ok(`authorization grant obtenido con scope "${scope}"`);
    lastGrantCode = code;

    const res = await fetch(`${BASE_URL}/api/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.TINK_CLIENT_ID!,
        client_secret: process.env.TINK_CLIENT_SECRET!,
        grant_type: "authorization_code",
      }),
    });
    const text = await res.text();
    if (!res.ok) { info(`canje del code → ${res.status} ${text.slice(0, 160)}`); continue; }
    const data = JSON.parse(text) as { access_token: string; scope?: string };
    ok(`user access token obtenido — scopes: ${data.scope ?? "(no devueltos)"}`);
    return data.access_token;
  }
  return null;
}

/** Provider records vary; pull the most plausible human-readable name. */
function nameOf(p: any): string {
  return p.displayName ?? p.name ?? p.financialInstitutionName ?? p.financialInstitution?.name ?? JSON.stringify(p).slice(0, 80);
}

(async () => {
  if (!process.env.TINK_CLIENT_ID || !process.env.TINK_CLIENT_SECRET) {
    bad("Faltan TINK_CLIENT_ID y/o TINK_CLIENT_SECRET en .env");
    process.exit(1);
  }

  head("1. Autenticación (POST /api/v1/oauth/token, client_credentials)");
  const token = await getClientToken();

  head("2. Localizando el endpoint de proveedores (token de CLIENTE)");
  let probe = await findProviders(token);

  if (!probe) {
    head("2b. El token de cliente no basta — probando el flujo de usuario permanente");
    const userId = await createPermanentUser(token);
    if (!userId) {
      bad("No se pudo crear el usuario permanente; sin él no hay user token.");
      process.exit(1);
    }
    const userToken = await getUserToken(token, userId);
    if (!userToken) {
      bad("No se pudo obtener un user access token con ningún scope.");
      info("Mira los códigos de arriba antes de concluir nada:");
      info("  403 → la app NO tiene autorizados esos scopes (eso sí es el muro de Tink).");
      info("  400 → petición mal formada; es un bug de este script, no un límite de tu cuenta.");
      process.exit(1);
    }
    head("2c. Reintentando proveedores con el user access token");
    probe = await findProviders(userToken);
  }

  if (!probe) {
    bad("El catálogo de proveedores por API sigue cerrado (falta `provider:read`).");
    if (lastGrantCode) {
      const redirect = process.env.TINK_REDIRECT_URI ?? "http://localhost:3002/api/banking/callback";
      head("Plan B — comprobar la cobertura a ojo, en el selector de bancos de Tink");
      info("Abre esta URL en el navegador: es el catálogo REAL de España.");
      info("Busca Revolut, BBVA, Santander, CaixaBank, Sabadell, Bankinter.");
      console.log(
        `\n    https://link.tink.com/1.0/transactions/connect-accounts` +
        `?client_id=${encodeURIComponent(process.env.TINK_CLIENT_ID!)}` +
        `&redirect_uri=${encodeURIComponent(redirect)}` +
        `&authorization_code=${encodeURIComponent(lastGrantCode)}` +
        `&market=ES&locale=es_ES\n`,
      );
      info(`El redirect_uri (${redirect}) debe estar dado de alta en Console → App settings,`);
      info("o Tink rechazará la petición antes de mostrar el selector.");
    } else {
      info("Sin authorization code no se puede ni abrir el selector: revisa los errores de arriba.");
    }
    process.exit(1);
  }

  head("3. Forma de un proveedor (para mapear a BankInstitution)");
  const sample = probe.providers[0];
  if (!sample || typeof sample !== "object") {
    bad(`lista no vacía pero sin objeto inspeccionable: ${JSON.stringify(probe.providers).slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`  ${JSON.stringify(sample, null, 2).split("\n").slice(0, 24).join("\n  ")}`);
  info(`campos disponibles: ${Object.keys(sample).join(", ")}`);

  head("4. ¿Están los bancos que te importan?");
  const targets = ["revolut", "bbva", "santander", "caixa", "sabadell", "ing", "bankinter", "openbank", "unicaja", "kutxabank", "abanca", "n26", "wise"];
  const haystack = probe.providers.map(p => ({ raw: p, text: JSON.stringify(p).toLowerCase() }));

  for (const t of targets) {
    const hits = haystack.filter(h => h.text.includes(t));
    if (hits.length === 0) {
      bad(`${t.toUpperCase()} — no aparece`);
    } else {
      ok(`${t.toUpperCase()} — ${hits.length} coincidencia(s): ${hits.slice(0, 3).map(h => nameOf(h.raw)).join(" | ")}`);
    }
  }

  head("5. Veredicto");
  const spanish = ["bbva", "santander", "caixa", "sabadell", "bankinter"].filter(t =>
    haystack.some(h => h.text.includes(t)));
  const hasRevolut = haystack.some(h => h.text.includes("revolut"));
  console.log(`  Bancos españoles principales encontrados: ${spanish.length}/5 (${spanish.join(", ") || "ninguno"})`);
  console.log(`  Revolut: ${hasRevolut ? "SÍ" : "NO"}`);
  console.log(
    spanish.length >= 4 && hasRevolut
      ? "\n  \x1b[32mCobertura suficiente — seguimos con Tink.\x1b[0m\n"
      : "\n  \x1b[31mCobertura insuficiente para el requisito — reconsiderar proveedor.\x1b[0m\n",
  );
})().catch(e => { console.error(`\n\x1b[31m${e.message}\x1b[0m\n`); process.exit(1); });
