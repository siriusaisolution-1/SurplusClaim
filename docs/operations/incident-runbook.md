# Incident Response Runbook (MVP)

## Detection
- Monitor structured logs for `rate_limited`, `request_failed`, and `request_completed` spikes per tenant.
- Track 5xx rates from API/worker health checks and CI failures in GitHub Actions.
- Alert on missing backups or migration failures.

## Triage
1. Assign an incident commander and scribe.
2. Capture the current request ID(s), tenant, and case reference(s) from logs to scope blast radius.
3. Identify whether the issue is security (auth bypass, data leak), availability (5xx, queue backlog), or integrity (migration failure, corrupted data).

## Containment
- For abusive tenants: lower rate limits via environment variables and redeploy; temporarily block tokens or revoke credentials.
- For compromised secrets: rotate in secret manager, invalidate cached credentials, and redeploy services.
- For bad deployments: rollback to last known good artifact or disable the faulty GitHub Action workflow run.

## Eradication
- Patch vulnerable code paths; add regression tests and lint/typecheck guards as needed.
- Remove malicious uploads or artifacts tied to identified request IDs and audit-log the removal.
- Re-run migrations in a safe environment to repair schema drift if necessary.

## Recovery
- Restore from latest backup (see backup/restore guide) if data integrity is in doubt.
- Re-enable traffic gradually; monitor rate-limit counters, error budgets, and worker queue depth.
- Close the incident with a summary of root cause, timeline, and follow-up actions.

## Communication
- Keep stakeholders informed via the chosen incident channel (e.g., Slack/Teams bridge).
- Notify affected tenants if data exposure or downtime impacted their cases.
- File follow-up tasks for playbook improvements, extra monitoring, and security hardening.
