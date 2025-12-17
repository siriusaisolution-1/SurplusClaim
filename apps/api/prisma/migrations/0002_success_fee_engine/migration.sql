-- Extend CaseStatus for payout lifecycle
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'DISCOVERED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'TRIAGED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'CLIENT_CONTACTED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'CONSENT_SIGNED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'DOCUMENT_COLLECTION';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'PACKAGE_READY';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'PAYOUT_CONFIRMED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'CLOSED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'ESCALATED';
ALTER TYPE "CaseStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';

-- Payout confirmation metadata
ALTER TABLE "Payout"
ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "confirmedBy" UUID REFERENCES "User"("id") ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS "evidenceKey" TEXT,
ADD COLUMN IF NOT EXISTS "feeCents" INTEGER,
ADD COLUMN IF NOT EXISTS "feeRateBps" INTEGER,
ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Fee agreements: state-specific and contract overrides
ALTER TABLE "FeeAgreement"
ADD COLUMN IF NOT EXISTS "stateCode" TEXT,
ADD COLUMN IF NOT EXISTS "contractRef" TEXT;
CREATE INDEX IF NOT EXISTS "fee_agreement_state_idx" ON "FeeAgreement"("tenantId", "stateCode");
CREATE INDEX IF NOT EXISTS "fee_agreement_contract_idx" ON "FeeAgreement"("tenantId", "contractRef");

-- Invoices
CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "caseId" UUID NOT NULL REFERENCES "Case"("id") ON DELETE CASCADE,
    "caseRef" TEXT NOT NULL,
    "payoutId" UUID REFERENCES "Payout"("id") ON DELETE SET NULL,
    "amountCents" INTEGER NOT NULL,
    "feeRateBps" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "dueAt" TIMESTAMPTZ,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "invoice_tenant_ref_idx" ON "Invoice"("tenantId", "caseRef");
CREATE INDEX IF NOT EXISTS "invoice_tenant_status_idx" ON "Invoice"("tenantId", "status");
