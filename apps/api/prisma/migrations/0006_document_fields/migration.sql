DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentStatus') THEN
        CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    END IF;
END
$$;

ALTER TABLE "Document" ADD COLUMN "originalFilename" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Document" ADD COLUMN "aiDocType" TEXT;
ALTER TABLE "Document" ADD COLUMN "aiConfidence" DOUBLE PRECISION;
ALTER TABLE "Document" ADD COLUMN "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Document" ADD COLUMN "reviewerId" UUID;
ALTER TABLE "Document" ADD COLUMN "reviewedAt" TIMESTAMPTZ;
ALTER TABLE "Document" ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "Document" ALTER COLUMN "originalFilename" DROP DEFAULT;
