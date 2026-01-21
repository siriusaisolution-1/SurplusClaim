# CI Modes

## RUN_DB_TESTS=false (default for local/non-DB runs)
- Database-dependent API tests are skipped.
- Prisma migrations are not applied as part of API tests.
- Required env vars:
  - `DATABASE_URL` (optional; defaults may be used by tests when DB tests are off).

## RUN_DB_TESTS=true (DB-backed CI mode)
- Requires a reachable Postgres instance.
- Prisma migrations are applied before API tests.
- Required env vars:
  - `DATABASE_URL`
  - `SHADOW_DATABASE_URL` (for optional Prisma drift check)
  - `JWT_ACCESS_SECRET`
  - `NODE_ENV`
  - `RUN_DB_TESTS`
