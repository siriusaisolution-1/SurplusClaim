# CI Modes

This repository supports multiple CI modes controlled by environment variables in the workflow.

## Default (full)
- Runs lint, typecheck, tests, and build steps.
- Database tests are enabled when `RUN_DB_TESTS=true` and require `DATABASE_URL`.

## Database tests
- `RUN_DB_TESTS=true`: enables DB-dependent tests.
- `DATABASE_URL` must point to the primary Postgres instance.
- `SHADOW_DATABASE_URL` is used for Prisma drift checks.

## API integration tests
- `RUN_API_INTEGRATION=true`: enables API integration tests in `apps/api/test`.
