-- Add metadata JSON column to store jurisdiction and procedural context
ALTER TABLE "Case" ADD COLUMN "metadata" JSONB;
