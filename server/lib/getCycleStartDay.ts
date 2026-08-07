// Small DB-aware wrapper around the pure period math in period.ts — kept
// separate so period.ts itself has no Prisma dependency and stays trivially
// unit-testable.
import { prisma } from "./prisma.js";
import { clampCycleStartDay } from "./period.js";

export async function getCycleStartDay(userId: string): Promise<number> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { cycleStartDay: true },
  });
  return clampCycleStartDay(settings?.cycleStartDay ?? 1);
}
