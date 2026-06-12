import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

export const rulesRouter = Router();

const MATCH_TYPES = new Set(["contains", "equals", "regex"]);

function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// GET /api/rules — all rules for the user, in evaluation order
rulesRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rules = await prisma.categorizationRule.findMany({
      where: { userId: req.userId! },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: { allocation: { select: { id: true, name: true, icon: true, type: true } } },
    });
    return res.json({ rules });
  } catch (err) {
    console.error("[rules/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/rules — create a manual rule
rulesRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { matchType, pattern, allocationId, priority } = req.body;

    const type = matchType ?? "contains";
    if (!MATCH_TYPES.has(type)) return res.status(400).json({ error: "Invalid matchType" });
    if (!pattern || !String(pattern).trim()) return res.status(400).json({ error: "Pattern is required" });
    if (type === "regex" && !validRegex(pattern)) return res.status(400).json({ error: "Invalid regular expression" });
    if (!allocationId) return res.status(400).json({ error: "allocationId is required" });

    const alloc = await prisma.allocation.findFirst({ where: { id: allocationId, userId: req.userId! } });
    if (!alloc) return res.status(400).json({ error: "Allocation not found" });

    const rule = await prisma.categorizationRule.create({
      data: {
        userId: req.userId!,
        matchType: type,
        pattern: String(pattern).trim(),
        allocationId,
        priority: priority !== undefined ? parseInt(priority) : 0,
        source: "manual",
      },
      include: { allocation: { select: { id: true, name: true, icon: true, type: true } } },
    });

    return res.json({ rule });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A rule with this match type and pattern already exists" });
    }
    console.error("[rules/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/rules/:id
rulesRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.categorizationRule.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Rule not found" });

    const { matchType, pattern, allocationId, priority } = req.body;

    if (matchType !== undefined && !MATCH_TYPES.has(matchType)) {
      return res.status(400).json({ error: "Invalid matchType" });
    }
    const effectiveType = matchType ?? existing.matchType;
    if (pattern !== undefined && !String(pattern).trim()) {
      return res.status(400).json({ error: "Pattern is required" });
    }
    const effectivePattern = pattern !== undefined ? String(pattern).trim() : existing.pattern;
    if (effectiveType === "regex" && !validRegex(effectivePattern)) {
      return res.status(400).json({ error: "Invalid regular expression" });
    }
    if (allocationId !== undefined) {
      const alloc = await prisma.allocation.findFirst({ where: { id: allocationId, userId: req.userId! } });
      if (!alloc) return res.status(400).json({ error: "Allocation not found" });
    }

    const rule = await prisma.categorizationRule.update({
      where: { id },
      data: {
        ...(matchType !== undefined && { matchType }),
        ...(pattern !== undefined && { pattern: String(pattern).trim() }),
        ...(allocationId !== undefined && { allocationId }),
        ...(priority !== undefined && { priority: parseInt(priority) }),
      },
      include: { allocation: { select: { id: true, name: true, icon: true, type: true } } },
    });

    return res.json({ rule });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A rule with this match type and pattern already exists" });
    }
    console.error("[rules/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/rules/:id
rulesRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.categorizationRule.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Rule not found" });

    await prisma.categorizationRule.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[rules/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
