-- Add attorney support and legal execution fields
CREATE TYPE "LegalExecutionMode" AS ENUM ('ATTORNEY_REQUIRED', 'OPS_DIRECT');

CREATE TABLE "Attorney" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "barNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attorney_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Case"
  ADD COLUMN "assignedAttorneyId" UUID,
  ADD COLUMN "legalExecutionMode" "LegalExecutionMode" NOT NULL DEFAULT 'ATTORNEY_REQUIRED',
  ADD COLUMN "expectedPayoutWindow" TEXT,
  ADD COLUMN "closureConfirmationRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Case"
  ADD CONSTRAINT "Case_assignedAttorneyId_fkey" FOREIGN KEY ("assignedAttorneyId") REFERENCES "Attorney"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Attorney"
  ADD CONSTRAINT "Attorney_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Attorney_tenantId_email_key" ON "Attorney"("tenantId", "email");
CREATE INDEX "Attorney_tenantId_barNumber_idx" ON "Attorney"("tenantId", "barNumber");
CREATE INDEX "Case_tenantId_assignedAttorneyId_idx" ON "Case"("tenantId", "assignedAttorneyId");
