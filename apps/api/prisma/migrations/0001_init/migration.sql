-- Create enums
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'TENANT_ADMIN', 'REVIEWER', 'OPS', 'B2B_CLIENT', 'READ_ONLY');
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'IN_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'PAID_OUT');
CREATE TYPE "TierLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'ENTERPRISE');
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "CommunicationChannel" AS ENUM ('EMAIL', 'SMS');

-- Tenants
CREATE TABLE "Tenant" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE "User" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "user_tenant_email_unique" UNIQUE("tenantId", "email")
);
CREATE INDEX "user_tenant_role_idx" ON "User"("tenantId", "role");

-- Cases
CREATE TABLE "Case" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL,
    "tierSuggested" "TierLevel" NOT NULL,
    "tierConfirmed" "TierLevel",
    "assignedReviewerId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "case_tenant_ref_unique" UNIQUE("tenantId", "caseRef"),
    CONSTRAINT "case_assigned_reviewer_fk" FOREIGN KEY("assignedReviewerId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "case_tenant_status_idx" ON "Case"("tenantId", "status");
CREATE INDEX "case_tenant_ref_idx" ON "Case"("tenantId", "caseRef");

-- Case Events
CREATE TABLE "CaseEvent" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID NOT NULL REFERENCES "Case"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "processedAt" TIMESTAMPTZ
);
CREATE INDEX "case_event_tenant_ref_idx" ON "CaseEvent"("tenantId", "caseRef");

-- Audit Log
CREATE TABLE "AuditLog" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID REFERENCES "Case"("id") ON DELETE SET NULL,
    "caseRef" TEXT NOT NULL,
    "actorId" UUID REFERENCES "User"("id") ON DELETE SET NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "hash" TEXT NOT NULL,
    "prevHash" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "audit_hash_unique" UNIQUE("tenantId", "hash")
);
CREATE INDEX "audit_tenant_ref_idx" ON "AuditLog"("tenantId", "caseRef");

-- Artifacts
CREATE TABLE "Artifact" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID NOT NULL REFERENCES "Case"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "artifact_object_unique" UNIQUE("tenantId", "objectKey")
);
CREATE INDEX "artifact_tenant_ref_idx" ON "Artifact"("tenantId", "caseRef");

-- Documents
CREATE TABLE "Document" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID NOT NULL REFERENCES "Case"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "docType" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "document_object_unique" UNIQUE("tenantId", "objectKey")
);
CREATE INDEX "document_tenant_ref_idx" ON "Document"("tenantId", "caseRef");

-- Consents
CREATE TABLE "Consent" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID NOT NULL REFERENCES "Case"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentArtifactId" UUID REFERENCES "Artifact"("id") ON DELETE SET NULL,
    "signedAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ
);
CREATE INDEX "consent_tenant_ref_idx" ON "Consent"("tenantId", "caseRef");

-- Communications
CREATE TABLE "Communication" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID NOT NULL REFERENCES "Case"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "communication_tenant_ref_idx" ON "Communication"("tenantId", "caseRef");
CREATE INDEX "communication_tenant_status_idx" ON "Communication"("tenantId", "status");

-- Payouts
CREATE TABLE "Payout" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID NOT NULL REFERENCES "Case"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "reference" TEXT,
    "processedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "payout_tenant_ref_idx" ON "Payout"("tenantId", "caseRef");
CREATE INDEX "payout_tenant_status_idx" ON "Payout"("tenantId", "status");

-- Fee Agreements
CREATE TABLE "FeeAgreement" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "tierMin" "TierLevel" NOT NULL,
    "tierMax" "TierLevel" NOT NULL,
    "capAmountCents" INTEGER,
    "minFeeCents" INTEGER,
    "b2bOverride" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "fee_agreement_tier_idx" ON "FeeAgreement"("tenantId", "tierMin", "tierMax");

-- Hash chaining helper view for audit verification (optional)
CREATE VIEW "AuditChainHead" AS
SELECT DISTINCT ON ("tenantId") "tenantId", "hash", "createdAt"
FROM "AuditLog"
ORDER BY "tenantId", "createdAt" DESC;
