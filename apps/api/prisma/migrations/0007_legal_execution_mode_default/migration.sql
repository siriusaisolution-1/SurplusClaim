ALTER TABLE "Case"
  ALTER COLUMN "legalExecutionMode" SET DEFAULT 'ATTORNEY_REQUIRED';

UPDATE "Case"
SET "legalExecutionMode" = 'ATTORNEY_REQUIRED'
WHERE "legalExecutionMode" IS NULL;

ALTER TABLE "Case"
  ALTER COLUMN "legalExecutionMode" SET NOT NULL;
