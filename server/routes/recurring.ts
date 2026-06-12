import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { detectRecurring } from "../lib/recurring.js";

export const recurringRouter = Router();

const STATUSES = new Set(["detected", "confirmed", "ignored"]);

// GET /api/recurring
// Re-runs detection, persists any newly-detected merchants (without clobbering
// the status/link of ones the user already acted on), and returns the list.
recurringRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const candidates = await detectRecurring(req.userId!);

    await Promise.all(
      candidates.map(c =>
        prisma.recurringCommitment.upsert({
          where: { userId_merchant: { userId: req.userId!, merchant: c.merchant } },
          // Refresh the figures only; never reset a user's confirm/ignore/link.
          update: { avgAmount: c.avgAmount, cadence: c.cadence, nextExpectedDate: c.nextExpectedDate },
          create: {
            userId: req.userId!,
            merchant: c.merchant,
            avgAmount: c.avgAmount,
            cadence: c.cadence,
            nextExpectedDate: c.nextExpectedDate,
            allocationId: c.allocationId,
            status: "detected",
          },
        })
      )
    );

    const commitments = await prisma.recurringCommitment.findMany({
      where: { userId: req.userId! },
      include: { allocation: { select: { id: true, name: true, icon: true, type: true } } },
      orderBy: [{ status: "asc" }, { avgAmount: "desc" }],
    });

    return res.json(serializeMoney({ commitments }));
  } catch (err) {
    console.error("[recurring/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/recurring/:id  — confirm / ignore and/or link to a fixed allocation
recurringRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.recurringCommitment.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Commitment not found" });

    const { status, allocationId } = req.body as { status?: string; allocationId?: string | null };
    if (status !== undefined && !STATUSES.has(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Validate a linked allocation belongs to the user.
    if (allocationId) {
      const alloc = await prisma.allocation.findFirst({ where: { id: allocationId, userId: req.userId! } });
      if (!alloc) return res.status(400).json({ error: "Allocation not found" });
    }

    const commitment = await prisma.recurringCommitment.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(allocationId !== undefined && { allocationId: allocationId || null }),
      },
      include: { allocation: { select: { id: true, name: true, icon: true, type: true } } },
    });

    return res.json(serializeMoney({ commitment }));
  } catch (err) {
    console.error("[recurring/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
