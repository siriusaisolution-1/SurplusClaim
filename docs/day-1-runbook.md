# Day-1 CI Runbook

## DB down or unreachable
1. Confirm Postgres service is running and healthy.
2. Verify `DATABASE_URL` points to the correct host/port.
3. Re-run CI after confirming readiness.

## Prisma migrate failure
1. Review migration logs in CI.
2. Run locally:
   - `pnpm --filter @surplus/api prisma:migrate`
3. Validate the migrations directory and schema alignment.

## Rollback steps
1. Revert to the last known good migration in version control.
2. Re-run `pnpm --filter @surplus/api prisma:migrate`.
3. Re-run CI to confirm stability.
