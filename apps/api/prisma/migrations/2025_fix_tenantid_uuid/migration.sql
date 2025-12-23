-- Drop existing foreign keys that reference Tenant.tenantId so we can alter column types.
DO $$DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname, relname
    FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
    WHERE conname ILIKE '%tenantid_fkey'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.relname, r.conname);
  END LOOP;
END$$;

-- Alter tenantId columns to uuid to match Tenant.id
ALTER TABLE "User" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Case" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "CaseEvent" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Artifact" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Document" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Consent" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Communication" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Payout" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "FeeAgreement" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Invoice" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;
ALTER TABLE "Session" ALTER COLUMN "tenantId" TYPE uuid USING "tenantId"::uuid;

-- Ensure Tenant.id is uuid
ALTER TABLE "Tenant" ALTER COLUMN "id" TYPE uuid USING "id"::uuid;

-- Recreate foreign keys with cascade behavior
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeeAgreement" ADD CONSTRAINT "FeeAgreement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
