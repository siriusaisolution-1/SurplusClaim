-- Adjust Session tenantId to use UUID type
ALTER TABLE "Session"
ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;

-- Enforce one-to-one relationships for consent artifacts and invoice payouts
ALTER TABLE "Consent"
ADD CONSTRAINT "Consent_consentArtifactId_key" UNIQUE ("consentArtifactId");

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_payoutId_key" UNIQUE ("payoutId");
