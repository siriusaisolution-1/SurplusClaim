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
The seed script creates/updates a demo tenant and admin user in `apps/api/prisma/seed.ts`.
1. Update the seed details (tenant name, admin email, password) as needed.
2. Run:
   ```bash
   pnpm --filter @surplus/api prisma:seed
   ```
3. Rotate the seeded password after first login.

## Health & Readiness Checks
- **API**:
  - `GET /health` → basic service check.
  - `GET /ready` → returns 200 only when the database is reachable.
- **Worker**:
  - `GET /health` → queue + connector status.
  - `GET /ready` → returns 200 only when the database is reachable and reminder/communication loops have valid intervals.
