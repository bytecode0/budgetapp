import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

export interface AuthRequest extends Request {
  userId?: string;     // effective userId — may point to the linked partner's data
  authUserId?: string; // actual authenticated userId (always the real user)
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

    // If this user has a linkedUserId, all data queries use that userId instead
    const settings = await prisma.userSettings.findUnique({
      where: { userId: payload.userId },
      select: { linkedUserId: true },
    });
    req.userId = settings?.linkedUserId ?? payload.userId;

    next();
  } catch {
    return res.status(401).json({ error: "Not authenticated" });
  }
}
