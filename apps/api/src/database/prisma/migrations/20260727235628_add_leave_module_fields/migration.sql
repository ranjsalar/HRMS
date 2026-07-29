-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "weekendDays" INTEGER[] DEFAULT ARRAY[5, 6]::INTEGER[];

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "rejectedBy" TEXT,
ADD COLUMN     "workingDays" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;
