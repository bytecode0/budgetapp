import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { ALLOCATION_NOT_FOUND, allocationsInPool, hiddenExpenseWhere, notOnHiddenLine, visibleExpenseWhere } from "../lib/poolRefs.js";
import { detectRecurring } from "../lib/recurring.js";

export const recurringRouter = Router();

const STATUSES = new Set(["detected", "confirmed", "ignored"]);

// The commitments as the caller may see them (callers already leave out
// those on a hidden line). Detection runs over the whole pool, so a merchant
// with movements hidden from the caller (the other member's rows on a
// private debt or account, poolRefs.ts) is shown only if the caller's own
// view detects it too, with the figures from that view — never amounts or
// dates taken from hidden rows. Every other commitment is unchanged, so a
// person alone in her pool (who has no hidden rows) sees exactly what
// detection stored, with or without movements left.
type Commitment = { merchant: string; avgAmount: number; cadence: string; nextExpectedDate: Date | null };
async function visibleCommitments<T extends Commitment>(req: AuthRequest, commitments: T[]): Promise<T[]> {
  if (commitments.length === 0) return commitments;
  const hidden = await prisma.expense.findMany({
    where: { userId: req.userId!, merchant: { in: commitments.map(c => c.merchant) }, ...hiddenExpenseWhere(req.authUserId!) },
    distinct: ["merchant"],
    select: { merchant: true },
  });
  if (hidden.length === 0) return commitments;
  const hiddenMerchants = new Set(hidden.map(e => e.merchant));
  const own = new Map((await detectRecurring(req.userId!, visibleExpenseWhere(req.authUserId!))).map(c => [c.merchant, c]));
  return commitments.flatMap(c => {
    if (!hiddenMerchants.has(c.merchant)) return [c];
    const mine = own.get(c.merchant);
    return mine ? [{ ...c, avgAmount: mine.avgAmount, cadence: mine.cadence, nextExpectedDate: mine.nextExpectedDate }] : [];
  });
}

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
      where: { userId: req.userId!, ...notOnHiddenLine(req.authUserId!) },
      include: { allocation: { select: { id: true, name: true, icon: true, type: true } } },
      orderBy: [{ status: "asc" }, { avgAmount: "desc" }],
    });

    return res.json(serializeMoney({ commitments: await visibleCommitments(req, commitments) }));
  } catch (err) {
    console.error("[recurring/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/recurring/:id  — confirm / ignore and/or link to a fixed allocation
recurringRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.recurringCommitment.findFirst({ where: { id, userId: req.userId!, ...notOnHiddenLine(req.authUserId!) } });
    if (!existing || (await visibleCommitments(req, [existing])).length === 0) return res.status(404).json({ error: "Commitment not found" });

    const { status, allocationId } = req.body as { status?: string; allocationId?: string | null };
    if (status !== undefined && !STATUSES.has(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Validate a linked allocation belongs to the user.
    if (!(await allocationsInPool(req.userId!, req.authUserId!, [allocationId]))) return res.status(404).json(ALLOCATION_NOT_FOUND);

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
