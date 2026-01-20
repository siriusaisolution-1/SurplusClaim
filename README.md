# AI-Assisted Tax Surplus / Excess Proceeds Recovery Platform

Monorepo skeleton for API, web, worker, and scraping services. All TypeScript projects share pnpm workspaces and strict TypeScript configurations; the scraper is a Python Scrapy service packaged for Scrapyd.

## Repository Layout
```
/apps
  /api        # NestJS API with /health endpoint
  /web        # Next.js front-end scaffold
  /worker     # NestJS worker with BullMQ and /health endpoint
/services
  /scraper    # Scrapy project with Scrapyd server
/packages
  /shared
  /audit
  /rules
  /connectors
/infra
  /docker     # Container definitions
  /scripts    # Helper scripts
```

## Prerequisites
- Node.js 20+
- pnpm 8+
- Python 3.11+
- Docker + Docker Compose v2

## Installation
```bash
pnpm install
python -m pip install --upgrade pip pip-tools
pip install -r services/scraper/requirements.txt
```

## Development
- **Run all TS apps**: `pnpm dev` (runs api, web, worker in parallel)
- **API dev server**: `pnpm --filter @surplus/api dev` (default port 3001)
- **Web dev server**: `pnpm --filter @surplus/web dev` (default port 3000)
- **Worker dev server**: `pnpm --filter @surplus/worker dev` (default port 3002)

### Testing
- **All JS/TS packages**: `pnpm test` (placeholder tests)
- **Scraper tests**: `python -m pytest services/scraper/tests`
- **CI modes**: See `docs/ci-modes.md` for environment flags that control CI behavior.

### Linting & Formatting
- `pnpm lint`
- `pnpm format`

## Docker Compose
Services started by `docker-compose up`:
- Postgres (5432)
- Redis (6379)
- MinIO (9000/9001)
- Scrapyd from `services/scraper` (6800)

The Scrapyd endpoint is reachable at `http://localhost:6800/`. Placeholder services for api/web/worker are provided behind the `dev` profile.

## Environment Variables
- `PORT` for each NestJS service (defaults: API 3001, worker 3002)
- `REDIS_HOST`, `REDIS_PORT` for worker queue connection (defaults to `localhost:6379`)
- MinIO: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (defaults in compose)
- Postgres: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (defaults in compose)

## Health Endpoints
- API: `GET /health` → `{ status: 'ok', service: 'api' }`
- Worker: `GET /health` → `{ status: 'ok', service: 'worker', queue: '<name>' }`
- Scraper: Scrapyd available at `http://localhost:6800/`

## Notes
- TypeScript config is strict via `tsconfig.base.json`.
- Python dependencies for the scraper are pinned via `requirements.in`/`requirements.txt` (pip-tools compatible).
- Update compiled requirements with `pip-compile services/scraper/requirements.in`.
