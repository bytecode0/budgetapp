import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { currentPeriodKey } from "../lib/period.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { isMissingTable, isPeaceScore } from "../lib/peace.js";

// "¿Cómo te sientes hoy con tu dinero?" (LPBETA-24, server/lib/peace.ts).
// Every read and write is keyed by the real person (req.authUserId), never by
// the pool (req.userId): a partner can't read or overwrite another's answer.
// The period is the household's budget period (the pool's payday), the one
// Home shows. "Ahora no" is kept per device by the client, not here.
export const checkinsRouter = Router();

const select = { period: true, score: true, createdAt: true } as const;

function fail(res: Response, where: string, err: unknown) {
  if (isMissingTable(err)) {
    console.error(`[checkins/${where}] the PeaceCheckin table does not exist: apply the LPBETA-24 SQL`);
    return res.status(503).json({ error: "unavailable" });
  }
  console.error(`[checkins/${where}]`, err);
  return res.status(500).json({ error: "Internal server error" });
}

async function periodNow(req: AuthRequest) {
  return currentPeriodKey(await getCycleStartDay(req.userId!));
}

// GET /api/checkins → { data: { period, current, ask, checkins } }
// checkins: my answers, oldest first by when they were given (not by period
// label: a payday change or leaving a household can make a later answer's
// label earlier). ask: no answer this period yet.
checkinsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [period, checkins] = await Promise.all([
      periodNow(req),
      prisma.peaceCheckin.findMany({ where: { userId: req.authUserId! }, select, orderBy: { createdAt: "asc" } }),
    ]);
    const current = checkins.find(c => c.period === period)?.score ?? null;
    return res.json({ data: { period, current, ask: current === null, checkins } });
  } catch (err) {
    return fail(res, "get", err);
  }
});

// POST /api/checkins { score: 1-5 } → { data: { period, score, createdAt } }
// One answer per period: answering again in the same period replaces the
// score (a mis-tap is corrected, never a second row); createdAt stays the
// first answer's.
checkinsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const score: unknown = req.body?.score;
    if (!isPeaceScore(score)) return res.status(400).json({ error: "score must be an integer from 1 to 5" });
    const userId = req.authUserId!;
    const period = await periodNow(req);
    const checkin = await prisma.peaceCheckin.upsert({
      where: { userId_period: { userId, period } },
      create: { userId, period, score },
      update: { score },
      select,
    });
    return res.json({ data: checkin });
  } catch (err) {
    return fail(res, "post", err);
  }
});
