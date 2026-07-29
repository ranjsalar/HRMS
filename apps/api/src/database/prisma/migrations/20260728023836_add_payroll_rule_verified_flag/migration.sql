-- AlterTable
ALTER TABLE "PayrollRegionRule" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PayrollTaxBracket" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;
