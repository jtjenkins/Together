# Development Scripts

Utility scripts for database management and development tasks.

## Setup

### setup-dev.sh

One-command setup for the entire development environment.

**Usage:**

```bash
./scripts/setup-dev.sh
```

**What it does:**

1. Installs Rust (if not present)
2. Installs sqlx-cli for database migrations
3. Verifies Docker is installed
4. Starts PostgreSQL container
5. Runs all database migrations
6. Loads seed data

**First time setup:** Just run this script and you're ready to go!

## Database Migrations (sqlx-cli)

We use **sqlx-cli** for database migrations - it works like Rails `db:migrate` with rollback support.

### Common Commands

```bash
cd server

# Run pending migrations (like Rails db:migrate)
sqlx migrate run

# Rollback last migration (like Rails db:rollback)
sqlx migrate revert

# Show migration status
sqlx migrate info

# Create new migration
sqlx migrate add name_of_migration

# Create database (if it doesn't exist)
sqlx database create

# Drop and recreate database
sqlx database drop && sqlx database create && sqlx migrate run
```

### Migration Workflow

**Creating a new migration:**

```bash
cd server
sqlx migrate add add_user_settings
# This creates: migrations/TIMESTAMP_add_user_settings.sql
# Edit the SQL file with your schema changes
sqlx migrate run
```

**Rolling back a mistake:**

```bash
cd server
sqlx migrate revert  # Undoes last migration using .down.sql file
# Fix your SQL file
sqlx migrate run     # Re-apply the fixed migration
```

**Note**: All migrations have corresponding `.down.sql` files for safe rollback.

**Checking migration status:**

```bash
cd server
sqlx migrate info
# Shows: Applied/Pending status for each migration
```

### Migration File Format

Files in `server/migrations/` follow this naming:

- Format: `YYYYMMDDHHMMSS_description.sql`
- Example: `20240216000001_users_and_auth.sql`
- sqlx tracks which migrations have been applied in `_sqlx_migrations` table

## Legacy Scripts

### migrate.sh

Basic shell script for running migrations without sqlx-cli (not recommended).
Use sqlx-cli instead for proper migration tracking and rollback support.

## Future Scripts

Additional development scripts will be added here as needed:

- `test.sh` - Run backend tests
- `dev.sh` - Start development servers
- `build.sh` - Build production binaries
