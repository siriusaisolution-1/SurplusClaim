-- CreateEnum
CREATE TYPE "ConnectorRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ConnectorRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "connectorId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "countyCode" TEXT NOT NULL,
    "status" "ConnectorRunStatus" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "finishedAt" TIMESTAMPTZ,
    "errorMessage" TEXT,
    "cursor" JSONB,
    "stats" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CreateTable
CREATE TABLE "ConnectorCursor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "connectorId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "countyCode" TEXT NOT NULL,
    "cursor" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CreateIndex
CREATE INDEX "connector_run_tenant_connector_created_idx" ON "ConnectorRun"("tenantId", "connectorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "connector_run_tenant_connector_status_idx" ON "ConnectorRun"("tenantId", "connectorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "connector_cursor_unique" ON "ConnectorCursor"("tenantId", "connectorId", "state", "countyCode");

-- AddForeignKey
ALTER TABLE "ConnectorRun" ADD CONSTRAINT "ConnectorRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ConnectorCursor" ADD CONSTRAINT "ConnectorCursor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
