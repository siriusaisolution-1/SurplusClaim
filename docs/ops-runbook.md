# Ops Runbook (Pilot Tenant)

## Deployment checklist
- Confirm required environment variables are set:
  - Database connectivity (`DATABASE_URL`).
  - Worker schedules (`COMMUNICATION_POLL_INTERVAL`, `DEADLINE_SCAN_INTERVAL_MS`).
  - Rate limits (`TENANT_RATE_LIMIT`, `TENANT_RATE_WINDOW_MS`, `LOGIN_GLOBAL_RATE_LIMIT`, `LOGIN_TENANT_RATE_LIMIT`).
  - Cost caps (`TENANT_DAILY_COMMS_CAP`, `TENANT_DAILY_AUTO_REMINDERS_CAP`).
  - Email provider and reminder defaults (`DEFAULT_REMINDER_RECIPIENT`, `DEFAULT_REMINDER_REPLY_TO`).
- Run migrations for the target environment.
- Verify `/health` (liveness) and `/ready` (readiness) on API and worker.
- Confirm audit verification job has a clear window (no pending migrations).

## Smoke test steps
1. Seed staging data:
   - `pnpm seed:beta`
2. Run production smoke checks:
   - `pnpm smoke:prod`
3. Verify API and worker logs for `request_completed` and `connector_poll_completed` events.

## Diagnostics
### Drift check failures
- Symptom: `audit.verify` or drift check fails.
- Actions:
  - Re-run verification for the affected tenant and inspect the earliest failing record.
  - Check `AuditLog` table ordering by `createdAt` and `id` to confirm hashes are contiguous.
  - Ensure no app nodes are writing with mismatched clock skew.

### Audit invalid
- Symptom: audit chain invalid or verification error.
- Actions:
  - Verify no manual edits were applied to `AuditLog`.
  - Confirm `audit_append_failed` logs are not present or are isolated.
  - Re-run audit export and compare the hash chain from the last known good snapshot.

### Reminder not scheduled
- Symptom: missing reminders for a case.
- Actions:
  - Check worker logs for `reminder_blocked_cap` or `reminder_skipped_missing_recipient`.
  - Inspect `CaseEvent` for `REMINDER_BLOCKED_CAP`, `DEADLINE_REMINDER_SCHEDULED`, or `SUBMISSION_REMINDER_SCHEDULED`.
  - Validate recipient and reply-to configuration in the tenant and environment.

### Email not sending
- Symptom: communications stuck in `pending` or `pending_auto`.
- Actions:
  - Check worker logs for `communication_send_failed`.
  - Validate provider credentials and outbound connectivity.
  - Ensure `DRY_RUN_EMAILS` is not enabled in production.

## Safe rollback guidance
- Roll back application deployments before database schema changes.
- If migrations were applied, keep the database in the newest schema and roll back code to the last compatible version.
- After rollback, confirm `/ready` passes and worker queues are draining normally.
