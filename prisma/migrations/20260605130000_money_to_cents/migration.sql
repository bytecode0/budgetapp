-- Convert all monetary columns from DOUBLE PRECISION (euros) to INTEGER (cents).
-- The USING clause scales each existing value by 100 and rounds, so no data is lost.

-- UserSettings.monthlyIncome
ALTER TABLE "UserSettings"
  ALTER COLUMN "monthlyIncome" DROP DEFAULT,
  ALTER COLUMN "monthlyIncome" TYPE INTEGER USING ROUND("monthlyIncome" * 100),
  ALTER COLUMN "monthlyIncome" SET DEFAULT 0;

-- LifePlan.targetAmount / currentAmount / monthlyContribution
ALTER TABLE "LifePlan"
  ALTER COLUMN "targetAmount" TYPE INTEGER USING ROUND("targetAmount" * 100),
  ALTER COLUMN "currentAmount" DROP DEFAULT,
  ALTER COLUMN "currentAmount" TYPE INTEGER USING ROUND("currentAmount" * 100),
  ALTER COLUMN "currentAmount" SET DEFAULT 0,
  ALTER COLUMN "monthlyContribution" DROP DEFAULT,
  ALTER COLUMN "monthlyContribution" TYPE INTEGER USING ROUND("monthlyContribution" * 100),
  ALTER COLUMN "monthlyContribution" SET DEFAULT 0;

-- Allocation.allocatedAmount / actualAmount
ALTER TABLE "Allocation"
  ALTER COLUMN "allocatedAmount" DROP DEFAULT,
  ALTER COLUMN "allocatedAmount" TYPE INTEGER USING ROUND("allocatedAmount" * 100),
  ALTER COLUMN "allocatedAmount" SET DEFAULT 0,
  ALTER COLUMN "actualAmount" DROP DEFAULT,
  ALTER COLUMN "actualAmount" TYPE INTEGER USING ROUND("actualAmount" * 100),
  ALTER COLUMN "actualAmount" SET DEFAULT 0;

-- Expense.amount
ALTER TABLE "Expense"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100);

-- PlanDeposit.amount
ALTER TABLE "PlanDeposit"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100);

-- MonthlyBudget.allocatedAmount
ALTER TABLE "MonthlyBudget"
  ALTER COLUMN "allocatedAmount" TYPE INTEGER USING ROUND("allocatedAmount" * 100);
