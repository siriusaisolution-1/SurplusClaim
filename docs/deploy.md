# Production Deployment (Spec v2 / Plan v2)

## Required Environment Variables
Use the app-specific `.env.example` files as a baseline and set production secrets in your secret manager (never commit them):
- `/.env.example`
- `/apps/api/.env.example`
- `/apps/worker/.env.example`
- `/apps/web/.env.example`

## Build + Generate
1. Install dependencies: `pnpm install`.
2. Generate Prisma client (CI-safe):
   ```bash
   pnpm run deploy:prepare
   ```
   This runs `prisma generate` for the API workspace so builds can compile without DB access.

## Database Migrations
Run migrations **after** your production database is reachable and before starting the API/worker:
```bash
pnpm --filter @surplus/api prisma:migrate
```
This runs `prisma migrate deploy` against the configured `DATABASE_URL`.

### When to run `prisma generate`
- **During build** (recommended): run `pnpm run deploy:prepare` in CI to generate Prisma client code.
- **After schema changes**: re-run `pnpm run deploy:prepare` any time `schema.prisma` changes.

## Seeding a Beta Tenant
The beta seed script creates/updates the Beta Tenant and two users.
1. Set required env vars:
   - `BETA_ADMIN_EMAIL`, `BETA_ADMIN_PASSWORD`
   - `BETA_REVIEWER_EMAIL`, `BETA_REVIEWER_PASSWORD`
2. Run:
   ```bash
   pnpm seed:beta
   ```

## Production Smoke Test
Run a repeatable smoke test against the API + DB + worker.
1. Ensure the worker is running (set `DRY_RUN_EMAILS=true` to avoid sending emails).
2. Set required env vars:
   - `API_BASE_URL` (e.g. `https://api.example.com/`)
   - `DATABASE_URL`
   - `BETA_ADMIN_EMAIL`, `BETA_ADMIN_PASSWORD`
3. Run:
   ```bash
   pnpm smoke:prod
   ```

## Health & Readiness Checks
- **API**:
  - `GET /health` → basic service check.
  - `GET /ready` → returns 200 only when the database is reachable.
- **Worker**:
  - `GET /health` → queue + connector status.
  - `GET /ready` → returns 200 only when the database is reachable and reminder/communication loops have valid intervals.
