# Pilot Launch Pack

## Pre-launch checklist
- Verify CI green on the latest main commit.
- Confirm `DATABASE_URL` and `SHADOW_DATABASE_URL` are set for the target environment.
- Run Prisma migrations with `prisma migrate deploy` from `apps/api`.
- Validate API health at `/health`.

## Launch steps
1. Deploy API, web, and worker services.
2. Run smoke tests against API endpoints.
3. Monitor logs for errors and latency spikes.

## Rollback
- Revert to the previous deployment artifact.
- Re-run `prisma migrate deploy` only if a forward-only migration was applied.
