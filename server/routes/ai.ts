import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { aiEnabled } from "../lib/ai/classify.js";

export const aiRouter = Router();

// GET /api/ai/status — whether AI features are configured on the server.
// The frontend gates its "Classify with AI" buttons on this.
aiRouter.get("/status", requireAuth, (_req: AuthRequest, res: Response) => {
  return res.json({ enabled: aiEnabled() });
});
