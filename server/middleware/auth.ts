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
