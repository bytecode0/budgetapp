import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { currentPeriodKey } from "../lib/period.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { isPeaceScore } from "../lib/peace.js";

// "¿Cómo te sientes hoy con tu dinero?" (LPBETA-24, server/lib/peace.ts).
// Every read and write is keyed by the real person (req.authUserId), never by
// the pool (req.userId): a partner can't read or overwrite another's answer.
// The period is the household's budget period (the pool's payday), the one
// Home shows. "Ahora no" is kept per device by the client, not here.
export const checkinsRouter = Router();

const select = { period: true, score: true, createdAt: true } as const;

async function periodNow(req: AuthRequest) {
  return currentPeriodKey(await getCycleStartDay(req.userId!));
}

// GET /api/checkins → { data: { period, current, ask, checkins } }
// checkins: my answers, oldest period first. ask: no answer this period yet.
checkinsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [period, checkins] = await Promise.all([
      periodNow(req),
      prisma.peaceCheckin.findMany({ where: { userId: req.authUserId! }, select, orderBy: { period: "asc" } }),
    ]);
    const current = checkins.find(c => c.period === period)?.score ?? null;
    return res.json({ data: { period, current, ask: current === null, checkins } });
  } catch (err) {
    console.error("[checkins/get]", err);
    return res.status(500).json({ error: "Internal server error" });
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
    console.error("[checkins/post]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
