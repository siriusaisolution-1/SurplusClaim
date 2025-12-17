# Secrets Management Guidance

## Development
- Use environment variable files such as `.env.local` (not committed to git) to store `DATABASE_URL`, `JWT_ACCESS_SECRET`, and third-party API keys.
- Keep per-developer overrides out of version control; rely on `.env.example` snippets in onboarding docs if needed.
- Rotate secrets after sharing them with new developers and remove unused credentials.

## Production
- Store secrets in a managed secret manager (e.g., AWS Secrets Manager, GCP Secret Manager, or Vault) with IAM-bound access.
- Inject secrets at runtime via environment variables; do **not** bake them into container images or CI logs.
- Enforce least privilege for service accounts that read secrets and restrict network egress from workloads.
- Rotate JWT signing keys and database credentials on a defined cadence; prefer rolling deployments with dual-key support.

## CI/CD
- Configure GitHub Actions repository/environment secrets for CI (`DATABASE_URL`, `JWT_ACCESS_SECRET`, etc.).
- Ensure migrations and tests run against disposable databases; never point CI at production data.
- Mask secrets in logs and avoid echoing them in scripts. Structured logger redacts PII and secrets before printing.
