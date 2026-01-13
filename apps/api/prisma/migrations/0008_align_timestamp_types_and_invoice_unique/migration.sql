-- Align timestamp columns with schema (timestamptz)
ALTER TABLE "Session"
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "revokedAt" TYPE TIMESTAMPTZ USING "revokedAt" AT TIME ZONE 'UTC';

ALTER TABLE "Communication"
  ALTER COLUMN "sendAt" TYPE TIMESTAMPTZ USING "sendAt" AT TIME ZONE 'UTC';

ALTER TABLE "Attorney"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ USING "updatedAt" AT TIME ZONE 'UTC';

-- Ensure Invoice payout IDs remain unique
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_payoutId_key" ON "Invoice"("payoutId");
