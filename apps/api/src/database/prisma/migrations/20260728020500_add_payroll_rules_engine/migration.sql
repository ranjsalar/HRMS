-- CreateEnum
CREATE TYPE "PayrollRegion" AS ENUM ('krg', 'federal_iraq');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "payrollRegion" "PayrollRegion" NOT NULL DEFAULT 'krg';

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "finalizedBy" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "breakdown" JSONB;

-- CreateTable
CREATE TABLE "PayrollRegionRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "region" "PayrollRegion" NOT NULL,
    "overtimeMultiplier" DECIMAL(4,2) NOT NULL,
    "standardMonthlyHours" INTEGER NOT NULL,
    "standardWorkingDaysPerMonth" INTEGER NOT NULL,
    "socialSecurityEmployeePct" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRegionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollTaxBracket" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "ruleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "upToAmount" DECIMAL(14,2),
    "ratePercent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "PayrollTaxBracket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRegionRule_companyId_region_key" ON "PayrollRegionRule"("companyId", "region");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollTaxBracket_ruleId_order_key" ON "PayrollTaxBracket"("ruleId", "order");

-- AddForeignKey
ALTER TABLE "PayrollRegionRule" ADD CONSTRAINT "PayrollRegionRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollTaxBracket" ADD CONSTRAINT "PayrollTaxBracket_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PayrollRegionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the two new tables. Both carry a nullable
-- companyId (null = system-wide default, same semantics as Holiday), so
-- the policy shape is copied verbatim from Holiday's (step 2): USING is
-- OR'd with an IS NULL check so every tenant can READ the system-wide
-- defaults, but WITH CHECK has no such branch, so a tenant-scoped
-- connection can only WRITE rows scoped to its own companyId — seeding or
-- editing the global default rules is a Super Admin (BYPASSRLS) operation.
ALTER TABLE "PayrollRegionRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollRegionRule"
  USING (
    "companyId" = current_setting('app.current_company_id', true)
    OR "companyId" IS NULL
  )
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "PayrollTaxBracket" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollTaxBracket"
  USING (
    "companyId" = current_setting('app.current_company_id', true)
    OR "companyId" IS NULL
  )
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true));
