-- Align tenant and related foreign keys to UUID columns
ALTER TABLE "Tenant" ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid;

ALTER TABLE "User"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid;

ALTER TABLE "Case"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "assignedReviewerId" SET DATA TYPE UUID USING "assignedReviewerId"::uuid;

ALTER TABLE "CaseEvent"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid;

ALTER TABLE "AuditLog"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid,
  ALTER COLUMN "actorId" SET DATA TYPE UUID USING "actorId"::uuid;

ALTER TABLE "Artifact"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid;

ALTER TABLE "Document"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid;

ALTER TABLE "Consent"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid,
  ALTER COLUMN "consentArtifactId" SET DATA TYPE UUID USING "consentArtifactId"::uuid;

ALTER TABLE "Communication"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid;

ALTER TABLE "Payout"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid;

ALTER TABLE "FeeAgreement"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid;

ALTER TABLE "Invoice"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "caseId" SET DATA TYPE UUID USING "caseId"::uuid,
  ALTER COLUMN "payoutId" SET DATA TYPE UUID USING "payoutId"::uuid;

-- Enforce one-to-one relations for optional foreign keys
CREATE UNIQUE INDEX IF NOT EXISTS "Consent_consentArtifactId_key" ON "Consent"("consentArtifactId");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_payoutId_key" ON "Invoice"("payoutId");

ALTER TABLE "Session"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenantId" SET DATA TYPE UUID USING "tenantId"::uuid,
  ALTER COLUMN "userId" SET DATA TYPE UUID USING "userId"::uuid;
