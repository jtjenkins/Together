#!/bin/bash
# Database Migration Script
# Usage: ./scripts/migrate.sh [up|reset|status]
#
# DEPRECATED: This script is provided as a fallback for environments
# where sqlx-cli cannot be installed. For production use, prefer:
#   cd server && sqlx migrate run

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Database connection settings
COMPOSE_FILE="docker-compose.dev.yml"
DB_USER="together"
DB_NAME="together_dev"
MIGRATIONS_DIR="server/migrations"

# Helper function to run psql command
run_psql() {
    local output
    local exit_code

    output=$(docker-compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" "$@" 2>&1)
    exit_code=$?

    # Show output but filter only Docker Compose noise, not PostgreSQL warnings
    echo "$output" | grep -v 'level=warning msg=".*[Cc]ontainer'

    return $exit_code
}

# Check if database is running and accepting connections
check_db() {
    # First check container is running
    if ! docker-compose -f "$COMPOSE_FILE" ps | grep -q "postgres.*Up"; then
        echo -e "${RED}❌ PostgreSQL container is not running${NC}"
        echo "Start it with: docker-compose -f $COMPOSE_FILE up -d"
        exit 1
    fi

    # Then verify PostgreSQL is accepting connections
    if ! docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U "$DB_USER" &> /dev/null; then
        echo -e "${RED}❌ PostgreSQL is not ready to accept connections${NC}"
        echo ""
        echo "Container is running but database is not responding"
        echo "Possible causes:"
        echo "  - PostgreSQL is still starting up (wait a few seconds)"
        echo "  - PostgreSQL crashed (check logs)"
        echo "  - Database is in recovery mode"
        echo ""
        echo "Check logs: docker-compose -f $COMPOSE_FILE logs postgres"
        exit 1
    fi
}

# Run all migrations
migrate_up() {
    echo -e "${YELLOW}⚠️  WARNING: This script does not track applied migrations${NC}"
    echo -e "${YELLOW}⚠️  Prefer: cd server && sqlx migrate run${NC}\n"
    echo -e "${GREEN}🚀 Running database migrations...${NC}\n"

    local failed=0
    for migration in "$MIGRATIONS_DIR"/*.sql; do
        filename=$(basename "$migration")
        echo -e "${YELLOW}▶ Applying $filename${NC}"

        if run_psql < "$migration"; then
            echo -e "${GREEN}✅ $filename applied successfully${NC}\n"
        else
            echo -e "${RED}❌ $filename FAILED${NC}"
            echo "Migration error in: $filename"
            echo "Remaining migrations will not be applied"
            echo ""
            echo "To investigate:"
            echo "  - Review SQL syntax in $migration"
            echo "  - Check database logs: docker-compose -f $COMPOSE_FILE logs postgres"
            echo "  - Verify previous migrations completed successfully"
            exit 1
        fi
    done

    echo -e "${GREEN}✅ All migrations completed successfully!${NC}"
}

# Reset database (drop all tables and rerun migrations)
migrate_reset() {
    # Check if running in interactive terminal
    if [ ! -t 0 ]; then
        echo -e "${RED}❌ Reset requires interactive terminal${NC}"
        echo "This prevents accidental data loss from scripts"
        exit 1
    fi

    echo -e "${RED}⚠️  WARNING: This will delete ALL data!${NC}"
    read -p "Type 'yes' to confirm: " confirm

    # Accept case-insensitive yes
    confirm_lower=$(echo "$confirm" | tr '[:upper:]' '[:lower:]')

    if [ "$confirm_lower" != "yes" ]; then
        echo -e "${YELLOW}Reset cancelled (you entered: '$confirm')${NC}"
        echo "You must type exactly 'yes' to confirm destructive operations"
        exit 0
    fi

    echo -e "${GREEN}Confirmed. Proceeding with reset...${NC}\n"
    echo -e "${YELLOW}🗑️  Dropping all tables...${NC}"

    # Drop and recreate schema with proper grants
    if ! run_psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO together; GRANT ALL ON SCHEMA public TO public;"; then
        echo -e "${RED}❌ Failed to reset database${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ Database reset${NC}\n"

    migrate_up
}

# Show database status
migrate_status() {
    echo -e "${GREEN}📊 Database Status${NC}\n"

    echo "Tables:"
    run_psql -c "\dt"

    echo -e "\nIndexes:"
    run_psql -c "SELECT COUNT(*) as index_count FROM pg_indexes WHERE schemaname = 'public';"

    echo -e "\nRow counts:"
    run_psql -c "
        SELECT
            schemaname,
            tablename,
            n_tup_ins - n_tup_del as row_count
        FROM pg_stat_user_tables
        ORDER BY tablename;
    "
}

# Main command handler
case "${1:-up}" in
    up)
        check_db
        migrate_up
        ;;
    reset)
        check_db
        migrate_reset
        ;;
    status)
        check_db
        migrate_status
        ;;
    *)
        echo "Usage: $0 [up|reset|status]"
        echo ""
        echo "Commands:"
        echo "  up      Run all migrations (DEPRECATED - use sqlx migrate run)"
        echo "  reset   Drop all tables and rerun migrations"
        echo "  status  Show database status and table counts"
        echo ""
        echo "DEPRECATED: This script does not track applied migrations."
        echo "Prefer using sqlx-cli: cd server && sqlx migrate run"
        exit 1
        ;;
esac
