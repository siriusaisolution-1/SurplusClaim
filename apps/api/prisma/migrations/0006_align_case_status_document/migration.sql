-- Align CaseStatus enum with current Prisma schema
CREATE TYPE "CaseStatus_new" AS ENUM (
  'DISCOVERED',
  'TRIAGED',
  'CLIENT_CONTACTED',
  'CONSENT_SIGNED',
  'DOCUMENT_COLLECTION',
  'PACKAGE_READY',
  'SUBMITTED',
  'PAYOUT_CONFIRMED',
  'CLOSED',
  'ESCALATED',
  'ON_HOLD'
);

ALTER TABLE "Case"
  ALTER COLUMN "status" TYPE "CaseStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'NEW' THEN 'DISCOVERED'
      WHEN "status"::text = 'IN_REVIEW' THEN 'TRIAGED'
      WHEN "status"::text = 'NEEDS_INFO' THEN 'DOCUMENT_COLLECTION'
      WHEN "status"::text = 'APPROVED' THEN 'PACKAGE_READY'
      WHEN "status"::text = 'REJECTED' THEN 'CLOSED'
      WHEN "status"::text = 'PAID_OUT' THEN 'PAYOUT_CONFIRMED'
      ELSE "status"::text
    END
  )::"CaseStatus_new";

DROP TYPE "CaseStatus";
ALTER TYPE "CaseStatus_new" RENAME TO "CaseStatus";

-- Add missing Document columns and status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentStatus') THEN
    CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;

ALTER TABLE "Document"
  ADD COLUMN "originalFilename" TEXT,
  ADD COLUMN "aiDocType" TEXT,
  ADD COLUMN "aiConfidence" DOUBLE PRECISION,
  ADD COLUMN "status" "DocumentStatus",
  ADD COLUMN "reviewerId" UUID,
  ADD COLUMN "reviewedAt" TIMESTAMPTZ,
  ADD COLUMN "reviewNote" TEXT;

UPDATE "Document" SET "originalFilename" = 'unknown' WHERE "originalFilename" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "originalFilename" SET NOT NULL;

UPDATE "Document" SET "status" = 'PENDING' WHERE "status" IS NULL;
ALTER TABLE "Document" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "Document" ALTER COLUMN "status" SET NOT NULL;
