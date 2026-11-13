// "¿Cómo te sientes hoy con tu dinero?" (LPBETA-24): one answer per person and
// budget period, a face stored as 1 (muy intranquilo) to 5 (en paz).
//
// Each answer is private: only its author reads it (GET /api/checkins, keyed by
// the real person, req.authUserId — never the pool, so a partner can't). Luis
// sees aggregates only, through `npm run stats:active` (or the SQL in
// docs/estadisticas-paz.md), and only of CLOSED calendar months (UTC, by when
// the answer was given): never a window that includes today, which would let
// two runs a day apart reveal one new answer. Per month: the average, and how
// many people as a band, only with MIN_GROUP or more; the 1–5 distribution
// only when every non-empty bucket has MIN_GROUP or more; the trend only when
// up, same and down each have MIN_GROUP or more. Never an individual answer,
// id or period.
import type { PrismaClient } from "@prisma/client";

export const MIN_PEACE_SCORE = 1;
export const MAX_PEACE_SCORE = 5;
/** Smallest group whose aggregates are shown. */
export const MIN_GROUP = 5;
/** Closed months reported, the last one first. */
export const STATS_MONTHS = 3;

export function isPeaceScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_PEACE_SCORE && v <= MAX_PEACE_SCORE;
}

/** The table doesn't exist yet (its SQL not applied): Prisma P2021, Postgres 42P01. */
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown } } | null;
  return e?.code === "P2021" || e?.code === "42P01" || e?.meta?.code === "42P01";
}

export interface PeaceRow { userId: string; score: number; createdAt: Date }

/** People counts are shown as bands, never exactly. */
export function peopleBand(n: number): string | null {
  if (n < MIN_GROUP) return null;
  if (n < 10) return "5–9";
  if (n < 20) return "10–19";
  if (n < 50) return "20–49";
  return "50+";
}

export interface PeaceMonth {
  month: string; // "YYYY-MM", calendar month (UTC)
  /** null: fewer than MIN_GROUP people answered that month. */
  summary: { average: number; people: string; distribution: number[] | null } | null;
}

export interface PeaceStats {
  months: PeaceMonth[]; // the last closed month first
  /** First answer vs latest (by when given), of people with 2+ answers given
   *  before the current month. null: not enough data to show it safely. */
  trend: { people: string; up: number; same: number; down: number } | null;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function computePeaceStats(rows: PeaceRow[], now: Date): PeaceStats {
  const currentStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const closed = rows
    .filter(r => isPeaceScore(r.score) && r.createdAt.getTime() < currentStart)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const months: PeaceMonth[] = [];
  for (let i = 1; i <= STATS_MONTHS; i++) {
    const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
    // One answer per person and month: their latest that month.
    const latest = new Map<string, number>();
    for (const r of closed) if (monthKey(r.createdAt) === key) latest.set(r.userId, r.score);
    const scores = [...latest.values()];
    const people = peopleBand(scores.length);
    if (!people) { months.push({ month: key, summary: null }); continue; }
    const distribution = [0, 0, 0, 0, 0];
    for (const s of scores) distribution[s - MIN_PEACE_SCORE] += 1;
    const safe = distribution.every(c => c === 0 || c >= MIN_GROUP);
    const average = Math.round((scores.reduce((a, b) => a + b, 0) * 10) / scores.length) / 10;
    months.push({ month: key, summary: { average, people, distribution: safe ? distribution : null } });
  }

  const byUser = new Map<string, PeaceRow[]>();
  for (const r of closed) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  let up = 0, same = 0, down = 0;
  for (const list of byUser.values()) {
    if (list.length < 2) continue;
    const first = list[0].score;
    const last = list[list.length - 1].score;
    if (last > first) up += 1; else if (last < first) down += 1; else same += 1;
  }
  const people = peopleBand(up + same + down);
  const trend = people && up >= MIN_GROUP && same >= MIN_GROUP && down >= MIN_GROUP ? { people, up, same, down } : null;
  return { months, trend };
}

/** Every answer; the ids only group a person's answers and are never printed.
 *  null: the PeaceCheckin table doesn't exist yet. */
export async function loadPeaceRows(prisma: PrismaClient): Promise<PeaceRow[] | null> {
  try {
    return await prisma.peaceCheckin.findMany({ select: { userId: true, score: true, createdAt: true } });
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export const MISSING_TABLE_NOTE = "la tabla PeaceCheckin no existe todavía (aplica el SQL de LPBETA-24): se omite";

export function formatPeaceStats(s: PeaceStats | null): string {
  const head = `Paz (LPBETA-24, 1 = muy intranquilo · 5 = en paz; meses cerrados, solo grupos de ${MIN_GROUP} o más):`;
  if (!s) return `${head}\n  ${MISSING_TABLE_NOTE}`;
  const lines = [head];
  for (const m of s.months) {
    if (!m.summary) { lines.push(`  ${m.month}: menos de ${MIN_GROUP}`); continue; }
    const dist = m.summary.distribution ? ` · distribución 1–5: ${m.summary.distribution.join(" / ")}` : "";
    lines.push(`  ${m.month}: media ${m.summary.average.toLocaleString("es-ES")} · ${m.summary.people} personas${dist}`);
  }
  lines.push(s.trend
    ? `  Con 2 o más respuestas (primera vs última): ${s.trend.people} personas · suben ${s.trend.up} · igual ${s.trend.same} · bajan ${s.trend.down}`
    : "  Con 2 o más respuestas: sin datos suficientes");
  return lines.join("\n");
}
