-- Align CaseStatus enum values with current workflow
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
    CASE "status"
      WHEN 'NEW' THEN 'DISCOVERED'
      WHEN 'IN_REVIEW' THEN 'TRIAGED'
      WHEN 'NEEDS_INFO' THEN 'CLIENT_CONTACTED'
      WHEN 'APPROVED' THEN 'PACKAGE_READY'
      WHEN 'REJECTED' THEN 'CLOSED'
      WHEN 'PAID_OUT' THEN 'PAYOUT_CONFIRMED'
      ELSE "status"::text
    END
  )::"CaseStatus_new";

DROP TYPE "CaseStatus";
ALTER TYPE "CaseStatus_new" RENAME TO "CaseStatus";

-- Document status tracking
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Document"
  ADD COLUMN "originalFilename" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "aiDocType" TEXT,
  ADD COLUMN "aiConfidence" DOUBLE PRECISION,
  ADD COLUMN "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewerId" UUID,
  ADD COLUMN "reviewedAt" TIMESTAMPTZ,
  ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "Document" ALTER COLUMN "originalFilename" DROP DEFAULT;

-- Consent artifact unique mapping
CREATE UNIQUE INDEX "Consent_consentArtifactId_key" ON "Consent"("consentArtifactId");
