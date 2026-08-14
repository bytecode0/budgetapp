// Recomputes a profile's stage from its current stored inputs and, if it
// actually changed, updates the cache and records a StageTransition. Called
// after Bloque 1 is (re)saved today; the plan's other triggers — month_close,
// a new radiografía, a manual recompute — are future callers of this same
// function, not separate logic.
import { prisma } from "../../prisma.js";
import { computeCompleteness, DEBTS_NONE_FLAG, type Completeness } from "../fields/registry.v1.js";
import { buildStageInputs } from "./inputs.js";
import { evaluateStage, type StageResult } from "./engine.js";
import { STAGE_CONFIG_V1 } from "./config.v1.js";

export type StageRecalcReason = "manual" | "new_radiografia" | "threshold_cross" | "month_close";

export interface RecalculateResult {
  completeness: Completeness;
  stage: StageResult;
}

export async function recalculateStage(profileId: string, reason: StageRecalcReason): Promise<RecalculateResult> {
  const [profile, fieldValues, debts] = await Promise.all([
    prisma.financialProfile.findUniqueOrThrow({ where: { id: profileId } }),
    prisma.profileFieldValue.findMany({ where: { profileId } }),
    prisma.profileDebt.findMany({ where: { profileId } }),
  ]);

  const presentFieldKeys = new Set(fieldValues.map((r) => r.fieldKey));
  const hasDebtsAnswer = presentFieldKeys.has(DEBTS_NONE_FLAG) || debts.length > 0;
  const incomeType = profile.incomeType === "irregular" ? "irregular" : "regular";

  const completeness = computeCompleteness({ presentFieldKeys, hasDebtsAnswer, incomeType });
  const inputs = buildStageInputs({ fieldValues, debts, hasDebtsAnswer, incomeType });
  const stage = evaluateStage(inputs);

  // Only a real, classifiable stage is worth caching or recording a
  // transition for — "not classifiable yet" isn't a stage to transition into
  // (principio 4: never invent one), so an incomplete profile just leaves
  // stageCache untouched (null, most likely) until it's fillable.
  if (stage.classifiable && stage.stageId !== profile.stageCache) {
    await prisma.$transaction([
      prisma.financialProfile.update({
        where: { id: profileId },
        data: { stageCache: stage.stageId, stageCacheAt: new Date() },
      }),
      prisma.stageTransition.create({
        data: {
          profileId,
          fromStage: profile.stageCache,
          toStage: stage.stageId as string,
          reason,
          engineConfigVersion: STAGE_CONFIG_V1.version,
          inputsSnapshot: inputs as unknown as object,
        },
      }),
    ]);
  }

  return { completeness, stage };
}
