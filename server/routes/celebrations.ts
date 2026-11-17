import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { isMissingTable } from "../lib/peace.js";
import { isCelebrationKey, loadUnseenCelebrations } from "../lib/celebrations.js";

// "Celebrar los hitos" (LPBETA-13, server/lib/celebrations.ts). The
// celebrations are derived from the pool's data (req.userId) as the viewer may
// see it; what has been seen is kept per real person (req.authUserId), so each
// member closes their own card and it never comes back on another device.
export const celebrationsRouter = Router();

function fail(res: Response, where: string, err: unknown) {
  if (isMissingTable(err)) {
    console.error(`[celebrations/${where}] the CelebrationSeen table does not exist: run db push (LPBETA-13)`);
    return res.status(503).json({ error: "unavailable" });
  }
  console.error(`[celebrations/${where}]`, err);
  return res.status(500).json({ error: "Internal server error" });
}

// GET /api/celebrations → { data: { celebrations } }: the ones not seen yet,
// biggest first (Home shows the first). Amounts in euros, like every response.
celebrationsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const celebrations = await loadUnseenCelebrations(req.userId!, req.authUserId!);
    return res.json({ data: serializeMoney({ celebrations }) });
  } catch (err) {
    return fail(res, "get", err);
  }
});

// POST /api/celebrations/seen { key } → { data: { key } }. Idempotent.
celebrationsRouter.post("/seen", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const key: unknown = req.body?.key;
    if (!isCelebrationKey(key)) return res.status(400).json({ error: "key is invalid" });
    const userId = req.authUserId!;
    await prisma.celebrationSeen.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key },
      update: {},
    });
    return res.json({ data: { key } });
  } catch (err) {
    return fail(res, "seen", err);
  }
});
