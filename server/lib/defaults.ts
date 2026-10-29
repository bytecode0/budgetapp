import { prisma } from "./prisma.js";
import { DEFAULT_ACCOUNT_NAME } from "./onboarding.js";
import { resolveLocale, type EmailLocale } from "./email/locales/index.js";

// Created in the user's language; existing rows are never renamed. Same
// wording as onboarding.lines.{fixed,flexible}.title in src/locales.
const DEFAULT_ALLOCATION_NAMES: Record<EmailLocale, { fixed: string; flexible: string }> = {
  es: { fixed: "Gastos fijos", flexible: "Gastos variables" },
  en: { fixed: "Fixed expenses", flexible: "Variable expenses" },
};

/** Every name signup ever seeded a default line with — today's, in both
 *  languages, and the original English ones. A default line still carrying one
 *  was never renamed (server/lib/partnerMerge.ts). */
export const SEEDED_DEFAULT_ALLOCATION_NAMES: ReadonlySet<string> = new Set([
  ...Object.values(DEFAULT_ALLOCATION_NAMES).flatMap(n => [n.fixed, n.flexible]),
  "Fixed Expenses", "Flexible Spending", // seeded before the names were localized
]);

function defaultAllocations(language: string | null | undefined) {
  const names = DEFAULT_ALLOCATION_NAMES[resolveLocale(language)];
  return [
    { name: names.fixed,    icon: "🏠", type: "fixed",    sortOrder: 0 },
    { name: names.flexible, icon: "🎯", type: "flexible", sortOrder: 1 },
  ];
}

// `language`: the UI language at sign-up, stored only when the settings row is
// created here (an existing row, e.g. from /register, keeps its language).
export async function createDefaultAllocations(userId: string, language?: EmailLocale) {
  const existing = await prisma.allocation.count({ where: { userId } });
  if (existing > 0) return; // already seeded

  const settings = await prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId, monthlyIncome: 0, ...(language && { language }) },
  });

  await prisma.allocation.createMany({
    data: defaultAllocations(settings.language).map((a) => ({
      ...a,
      userId,
      allocatedAmount: 0,
      actualAmount: 0,
      isDefault: true,
    })),
  });

  await createDefaultAccount(userId);
}

// Seed a default "Main" account so every user has somewhere to attach expenses.
// Safe to call repeatedly: no-op if the user already has an account.
export async function createDefaultAccount(userId: string) {
  const existing = await prisma.account.count({ where: { userId } });
  if (existing > 0) return;

  await prisma.account.create({
    data: {
      userId,
      ownerUserId: userId,
      name: DEFAULT_ACCOUNT_NAME,
      type: "checking",
      sortOrder: 0,
    },
  });
}
