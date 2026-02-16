#!/bin/bash
# Database Migration Script
# Usage: ./scripts/migrate.sh [up|down|reset|status]

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
    docker-compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" "$@" 2>&1 | grep -v "level=warning"
}

# Check if database is running
check_db() {
    if ! docker-compose -f "$COMPOSE_FILE" ps | grep -q "postgres.*Up"; then
        echo -e "${RED}❌ Database is not running${NC}"
        echo "Start it with: docker-compose -f $COMPOSE_FILE up -d"
        exit 1
    fi
}

# Run all migrations
migrate_up() {
    echo -e "${GREEN}🚀 Running database migrations...${NC}\n"

    for migration in "$MIGRATIONS_DIR"/*.sql; do
        filename=$(basename "$migration")
        echo -e "${YELLOW}▶ Applying $filename${NC}"
        run_psql < "$migration"
        echo -e "${GREEN}✅ $filename applied${NC}\n"
    done

    echo -e "${GREEN}✅ All migrations completed successfully!${NC}"
}

# Reset database (drop all tables and rerun migrations)
migrate_reset() {
    echo -e "${RED}⚠️  WARNING: This will delete all data!${NC}"
    read -p "Are you sure? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Reset cancelled"
        exit 0
    fi

    echo -e "${YELLOW}🗑️  Dropping all tables...${NC}"
    run_psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
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
        echo "  up      Run all migrations (default)"
        echo "  reset   Drop all tables and rerun migrations"
        echo "  status  Show database status and table counts"
        exit 1
        ;;
esac
