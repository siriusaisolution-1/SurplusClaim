-- Backfill missing legalExecutionMode values and enforce defaults
UPDATE "Case" SET "legalExecutionMode" = 'ATTORNEY_REQUIRED' WHERE "legalExecutionMode" IS NULL;
ALTER TABLE "Case" ALTER COLUMN "legalExecutionMode" SET DEFAULT 'ATTORNEY_REQUIRED';
ALTER TABLE "Case" ALTER COLUMN "legalExecutionMode" SET NOT NULL;
