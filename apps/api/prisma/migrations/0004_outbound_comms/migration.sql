-- Add outbound communication metadata
ALTER TABLE "Communication"
  ADD COLUMN "templateId" TEXT,
  ADD COLUMN "templateVersion" TEXT,
  ADD COLUMN "recipient" TEXT,
  ADD COLUMN "variables" JSONB,
  ADD COLUMN "sendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "providerMessageId" TEXT;
