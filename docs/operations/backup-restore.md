# Backup and Restore Guide

## Scope
Covers PostgreSQL (primary datastore) and uploaded documents stored on the application server filesystem under `services/uploads`.

## Backups
- **Database**: Run `pg_dump` on a scheduled job (e.g., hourly differentials, daily full). Store encrypted dumps in object storage with lifecycle rules.
- **Uploads**: Use a cron job or storage bucket versioning to snapshot `services/uploads` (or the equivalent object storage prefix) alongside checksum manifests.
- **Configuration**: Export Kubernetes manifests/Helm values or docker-compose overrides used for production deployment.

## Restoration
1. Halt write traffic by scaling API replicas to zero or enabling maintenance mode.
2. Restore the database:
   - Create a new PostgreSQL instance or empty database.
   - Import the selected dump with `psql < dump.sql`.
   - Run `pnpm --filter @surplus/api exec prisma migrate deploy --schema apps/api/prisma/schema.prisma` to re-apply migrations.
3. Restore uploads:
   - Sync the archived `services/uploads` snapshot (or object storage prefix) back to the deployment storage location.
   - Verify checksums against the manifest to ensure file integrity.
4. Bring services back online gradually and watch structured logs for request errors or missing document references.

## Validation
- Execute a smoke test: authenticate, fetch case lists, and download a restored document to ensure end-to-end wiring.
- Confirm audit log continuity for the restored time range.
- Document the restore window and any data gaps for affected tenants.
