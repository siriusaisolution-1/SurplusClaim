# Threat Model

This document captures the primary security assumptions and mitigations for the Surplus Claim MVP API, worker, and web clients.

## Assets
- Tenant and user identities, roles, and authentication tokens.
- Case data (metadata, documents, payouts, audit logs).
- Uploaded documents and generated artifacts.
- Application secrets (JWT signing keys, database credentials, third-party API keys).

## Actors & Entry Points
- **End users / tenant staff** interacting via the web UI and API.
- **B2B clients** integrating via authenticated API calls.
- **Background workers** processing queues and third-party connectors.
- **Administrators** with access to cloud consoles, CI logs, and databases.

## Key Threats & Mitigations
- **Unauthorized access / privilege escalation**: Enforced via JWT-based auth guard, role checks, audit logging, and per-tenant rate limiting. Minimum roles defined in controllers and enforced globally.
- **Excessive resource usage / abuse**: Per-tenant rate limiting with configurable limits and `Retry-After` headers to reduce noisy-neighbor risk.
- **Data exfiltration via logs**: Structured logging redacts PII (email, phone, addresses, secrets) and includes request scoping (request IDs, tenant IDs, case refs) for traceability.
- **Malicious uploads**: File uploads restricted to PDF/JPEG/PNG types with size caps and memory storage; documents are associated with cases and audited.
- **Secrets leakage**: Secrets are not committed to VCS; development uses `.env` files excluded from git, production must use a secret manager with least-privilege access.
- **Data loss**: Backup and restore playbooks defined; database migrations run in CI before deployment to prevent drift.
- **Supply-chain risk**: Lock down package manager to pnpm, run lint/typecheck/tests/build in CI, and pin Node version in workflows.

## Assumptions
- TLS termination handled by the platform/ingress.
- Production deployment runs behind a WAF/load balancer that forwards `X-Request-Id` when present.
- Database and object storage support encryption at rest and in transit.

## Residual Risks
- In-memory rate limiting can be bypassed if multiple API replicas are used without shared storage; consider Redis-backed limiter for production scale.
- Upload validation uses MIME/ext heuristics; deep content inspection may be required for high-assurance environments.
- Audit log append failures are logged but not retried; evaluate durable queues for audit events.
