import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { aiEnabled } from "../lib/ai/classify.js";
import { aiAvailable } from "../lib/ai/index.js";

export const aiRouter = Router();

// GET /api/ai/status — whether AI features are configured on the server.
// The frontend gates its "Classify with AI" buttons on `enabled` (Anthropic
// classification) and the column-mapping suggestion on `importMapping`
// (server/lib/ai/index.ts: AI_PROVIDER + key + AI_MODEL_IMPORT_MAPPING).
aiRouter.get("/status", requireAuth, (_req: AuthRequest, res: Response) => {
  return res.json({ enabled: aiEnabled(), importMapping: aiAvailable("importMapping") });
});
