-- AlterTable
ALTER TABLE "TaskBillableEntry" ADD COLUMN "netsuiteId" TEXT;
ALTER TABLE "TaskBillableEntry" ADD COLUMN "nsSyncStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "TaskBillableEntry" ADD COLUMN "nsSyncedAt" TIMESTAMP(3);
ALTER TABLE "TaskBillableEntry" ADD COLUMN "nsSyncError" TEXT;
