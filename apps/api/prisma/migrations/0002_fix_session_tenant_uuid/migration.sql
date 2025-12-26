-- Ensure Session.tenantId matches Tenant.id UUID type
DO $$
BEGIN
  -- Drop existing foreign key if present to allow type adjustments
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Session_tenantId_fkey'
      AND table_name = 'Session'
  ) THEN
    ALTER TABLE "Session" DROP CONSTRAINT "Session_tenantId_fkey";
  END IF;
END $$;

-- Align tenantId column type with Tenant.id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Session'
      AND column_name = 'tenantId'
      AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE "Session" ALTER COLUMN "tenantId" TYPE UUID USING "tenantId"::uuid;
  END IF;
END $$;

-- Recreate foreign key constraint after type alignment
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
