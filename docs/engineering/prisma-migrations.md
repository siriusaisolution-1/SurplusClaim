# Prisma migration discipline

## Rules of engagement

- Never edit or re-run applied migrations. Applied migration files are immutable history.
- If a migration needs to change after it has been applied, create a new migration that moves the schema forward.
- Keep migration files reviewed and committed with the schema changes that created them.

## Create a migration

1. Update `apps/api/prisma/schema.prisma` with the intended schema changes.
2. From the repo root, create the migration:

   ```bash
   pnpm --filter @surplus/api exec prisma migrate dev --schema ./prisma/schema.prisma --name <short_description>
   ```

3. Review the generated SQL in `apps/api/prisma/migrations/<timestamp>_<short_description>/migration.sql`.
4. Commit the updated schema and the new migration together.

## Run a local drift check

1. Ensure you have a shadow database URL set in your environment:

   ```bash
   export SHADOW_DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<shadow_db>"
   ```

2. Run the drift check from the repo root:

   ```bash
   pnpm prisma:drift
   ```

3. If the command exits non-zero, reconcile the schema or create a new migration to align the history.
