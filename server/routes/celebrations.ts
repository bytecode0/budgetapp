import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { isMissingTable } from "../lib/peace.js";
import { isCelebrationKey, loadUnseenCelebrations, markCelebrationSeen } from "../lib/celebrations.js";

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
// A person's first read shows nothing and marks what is already true as seen.
celebrationsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const celebrations = await loadUnseenCelebrations(req.userId!, req.authUserId!);
    return res.json({ data: serializeMoney({ celebrations }) });
  } catch (err) {
    return fail(res, "get", err);
  }
});

// POST /api/celebrations/seen { key } → { data: { key } }. Only a key that is
// one of the caller's current celebrations (400 otherwise). Idempotent: a
// second tap on one already seen is fine. Seeing a plan's celebration closes
// every level of that plan (server/lib/celebrations.ts keysSeenWith).
celebrationsRouter.post("/seen", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const key: unknown = req.body?.key;
    if (!isCelebrationKey(key) || !(await markCelebrationSeen(req.userId!, req.authUserId!, key))) {
      return res.status(400).json({ error: "key is invalid" });
    }
    return res.json({ data: { key } });
  } catch (err) {
    return fail(res, "seen", err);
  }
});
