# Pilot Launch Pack

## Quick start
1. Ensure Postgres is running and reachable at `DATABASE_URL`.
2. Install dependencies:
   - `pnpm install`
3. Run checks:
   - `pnpm lint`
   - `pnpm exec tsc -p apps/api/tsconfig.json --noEmit`
   - `pnpm test`
   - `pnpm -r --filter "./apps/**" build`

## Sanity endpoints
- API health: `GET /health`
- Worker health: `GET /health`

## Verification commands
- `pnpm test` (set `RUN_DB_TESTS=true` for DB-backed tests)
- `pnpm --filter @surplus/api prisma:migrate`
