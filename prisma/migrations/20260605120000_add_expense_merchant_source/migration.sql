-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "merchant" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateIndex
CREATE INDEX "Expense_userId_merchant_idx" ON "Expense"("userId", "merchant");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_userId_externalId_key" ON "Expense"("userId", "externalId");
