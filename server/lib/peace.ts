// "¿Cómo te sientes hoy con tu dinero?" (LPBETA-24): one answer per person and
// budget period, a face stored as 1 (muy intranquilo) to 5 (en paz).
//
// Each answer is private: only its author reads it (GET /api/checkins, keyed by
// the real person, req.authUserId — never the pool, so a partner can't). Luis
// sees aggregates only, through `npm run stats:active`, and only for groups of
// MIN_GROUP or more: among friends who know each other, the average of two
// people identifies someone. Never an individual answer, id or period.
import type { PrismaClient } from "@prisma/client";

export const MIN_PEACE_SCORE = 1;
export const MAX_PEACE_SCORE = 5;
/** Smallest group whose aggregates are shown. */
export const MIN_GROUP = 5;
/** "Last period": each person's latest answer, if given in the last 31 days
 *  (periods follow each household's payday, so there is no single label). */
export const RECENT_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isPeaceScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_PEACE_SCORE && v <= MAX_PEACE_SCORE;
}

export interface PeaceRow { userId: string; period: string; score: number; createdAt: Date }

export interface PeaceStats {
  /** Each person's latest answer from the last RECENT_DAYS days. */
  recent: { answered: number; average: number; distribution: number[] } | null; // null: fewer than MIN_GROUP
  /** People with 2+ answers: their first answer (the baseline) vs their latest. */
  trend: { people: number; up: number; same: number; down: number } | null;     // null: fewer than MIN_GROUP
}

export function computePeaceStats(rows: PeaceRow[], now: Date): PeaceStats {
  const byUser = new Map<string, PeaceRow[]>();
  for (const r of rows) {
    if (!isPeaceScore(r.score)) continue;
    const list = byUser.get(r.userId) ?? [];
    list.push(r);
    byUser.set(r.userId, list);
  }

  const since = now.getTime() - RECENT_DAYS * DAY_MS;
  const recentScores: number[] = [];
  let up = 0, same = 0, down = 0;
  for (const list of byUser.values()) {
    list.sort((a, b) => a.period.localeCompare(b.period));
    const first = list[0];
    const latest = list[list.length - 1];
    if (latest.createdAt.getTime() >= since) recentScores.push(latest.score);
    if (list.length >= 2) {
      if (latest.score > first.score) up += 1;
      else if (latest.score < first.score) down += 1;
      else same += 1;
    }
  }

  const people = up + same + down;
  const distribution = [0, 0, 0, 0, 0];
  for (const s of recentScores) distribution[s - MIN_PEACE_SCORE] += 1;
  const sum = recentScores.reduce((a, b) => a + b, 0);
  return {
    recent: recentScores.length >= MIN_GROUP
      ? { answered: recentScores.length, average: Math.round((sum * 10) / recentScores.length) / 10, distribution }
      : null,
    trend: people >= MIN_GROUP ? { people, up, same, down } : null,
  };
}

/** Every answer, without anything that says whose beyond an opaque id (the
 *  ids only group a person's answers; they are never printed). */
export function loadPeaceRows(prisma: PrismaClient): Promise<PeaceRow[]> {
  return prisma.peaceCheckin.findMany({ select: { userId: true, period: true, score: true, createdAt: true } });
}

export function formatPeaceStats(s: PeaceStats): string {
  const fewer = `menos de ${MIN_GROUP}: no se muestra`;
  const lines = [
    `Paz (LPBETA-24, 1 = muy intranquilo · 5 = en paz; solo grupos de ${MIN_GROUP} o más):`,
    s.recent
      ? `  Último periodo (${RECENT_DAYS} días): ${s.recent.answered} respondieron · media ${s.recent.average.toLocaleString("es-ES")} · distribución 1–5: ${s.recent.distribution.join(" / ")}`
      : `  Último periodo (${RECENT_DAYS} días): ${fewer}`,
    s.trend
      ? `  Con 2 o más respuestas (primera vs última): ${s.trend.people} personas · suben ${s.trend.up} · igual ${s.trend.same} · bajan ${s.trend.down}`
      : `  Con 2 o más respuestas: ${fewer}`,
  ];
  return lines.join("\n");
}
