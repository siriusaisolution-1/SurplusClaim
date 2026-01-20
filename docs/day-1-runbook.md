# Day-1 Runbook

## First checks
- Confirm service health endpoints respond (`/health`).
- Validate database connectivity via `DATABASE_URL`.
- Check CI status for the current release tag.

## On-call quick actions
- Restart the API service if health checks fail.
- Verify Postgres availability and connection limits.
- Review worker queue depth and Redis connectivity.

## Escalation
- Capture logs for the failing service and recent deployment changes.
- Notify the team with a summary, timestamps, and mitigation steps taken.
