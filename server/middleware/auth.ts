import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

export interface AuthRequest extends Request {
  userId?: string;       // effective userId — may point to the linked partner's data (legacy pool)
  authUserId?: string;   // actual authenticated userId (always the real user)
  householdId?: string;  // active household scope (Epic H1); null until the user joins/creates one
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const payload = verifyToken(token);

    req.authUserId = payload.userId;

    // A token can outlive its user — e.g. after a dev DB reset (`npm run db:reset`)
    // wipes the users table but the browser keeps the cookie. Verify the user
    // still exists so a stale token returns a clean 401 instead of crashing
    // downstream (FK violations on default seeding, etc.).
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true },
    });
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    // Legacy pool: if this user has a linkedUserId, data queries use that userId.
    // Kept in parallel with the new Household scope during migration (Epic H1).
    const settings = await prisma.userSettings.findUnique({
      where: { userId: payload.userId },
      select: { linkedUserId: true },
    });
    req.userId = settings?.linkedUserId ?? payload.userId;

    // New scope: the household this person belongs to (null until they join one).
    // Additive — does not change req.userId, so existing queries are unaffected.
    const membership = await prisma.householdMember.findFirst({
      where: { userId: payload.userId, status: "active" },
      select: { householdId: true },
    });
    req.householdId = membership?.householdId;

    next();
  } catch {
    return res.status(401).json({ error: "Not authenticated" });
  }
}
