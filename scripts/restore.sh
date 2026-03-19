#!/usr/bin/env bash
# Full restore of Together — PostgreSQL database + file uploads.
# Usage: ./scripts/restore.sh <timestamp> [--uploads-only|--database-only]
#
# <timestamp> format: YYYYMMDD_HHMMSS (matches backup filenames)
#
# Examples:
#   ./scripts/restore.sh 20260312_042700       # Restore both database and uploads
#   ./scripts/restore.sh 20260312_042700 --database-only  # Database only
#   ./scripts/restore.sh 20260312_042700 --uploads-only    # Uploads only
#
# Reads POSTGRES_USER and POSTGRES_DB from .env (if present) or the environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if present
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +o allexport
fi

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
POSTGRES_USER="${POSTGRES_USER:-together}"
POSTGRES_DB="${POSTGRES_DB:-together_prod}"

# Parse arguments
if [[ $# -eq 0 ]]; then
  echo "❌ Error: Missing timestamp argument"
  echo "Usage: $0 <timestamp> [--uploads-only|--database-only]"
  echo "Example: $0 20260312_042700"
  exit 1
fi

TIMESTAMP="$1"
RESTORE_UPLOADS=true
RESTORE_DATABASE=true

shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uploads-only)
      RESTORE_DATABASE=false
      shift
      ;;
    --database-only)
      RESTORE_UPLOADS=false
      shift
      ;;
    *)
      echo "❌ Error: Unknown option $1"
      exit 1
      ;;
  esac
done

DB_BACKUP_FILE="$BACKUP_DIR/together_${TIMESTAMP}.sql.gz"
UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"

echo "🐘 Together Full Restore"
echo "========================"
echo "Timestamp: $TIMESTAMP"
echo ""

# Validate backup files exist
if [[ "$RESTORE_DATABASE" == true ]]; then
  if [[ ! -f "$DB_BACKUP_FILE" ]]; then
    echo "❌ Error: Database backup not found: $DB_BACKUP_FILE"
    exit 1
  fi
  echo "✅ Database backup found: $DB_BACKUP_FILE"
fi

if [[ "$RESTORE_UPLOADS" == true ]]; then
  if [[ ! -f "$UPLOADS_BACKUP_FILE" ]]; then
    echo "❌ Error: Uploads backup not found: $UPLOADS_BACKUP_FILE"
    exit 1
  fi
  echo "✅ Uploads backup found: $UPLOADS_BACKUP_FILE"
fi

echo ""
echo "⚠️  WARNING: This will overwrite existing data!"
read -p "Are you sure you want to proceed? [yes/NO]: " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
  echo "❌ Aborted"
  exit 0
fi

echo ""

# Stop services before restore
echo "🛑 Stopping services..."
docker compose -f "$ROOT_DIR/docker-compose.yml" down

# Restore database
if [[ "$RESTORE_DATABASE" == true ]]; then
  echo "📦 Restoring database '$POSTGRES_DB'..."
  gunzip < "$DB_BACKUP_FILE" | \
    docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    psql -U "$POSTGRES_USER" "$POSTGRES_DB"
  echo "   ✅ Database restored"
fi

# Restore uploads
if [[ "$RESTORE_UPLOADS" == true ]]; then
  echo "📦 Restoring file uploads..."
  
  # Remove existing uploads (optional, but recommended to avoid conflicts)
  docker run --rm -v together_uploads_data:/data alpine sh -c "rm -rf /data/*"
  
  # Extract backup into uploads volume
  docker run --rm -v together_uploads_data:/data -v "$(pwd)/backups":/backup \
    alpine tar xzf "$UPLOADS_BACKUP_FILE" -C /data
  echo "   ✅ File uploads restored"
fi

# Start services
echo "🚀 Starting services..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

# Verify the restore
echo ""
echo "🔍 Verifying restore..."
HEALTH_CHECK=$(docker compose -f "$ROOT_DIR/docker-compose.yml" exec server \
  curl -s http://localhost:8080/api/health || echo '{"status":"error"}')

if echo "$HEALTH_CHECK" | grep -q '"status":"ok"'; then
  echo "   ✅ Services are healthy"
else
  echo "   ⚠️  Health check failed. Check logs with: docker compose logs server"
fi

echo ""
echo "✨ Restore complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Check that your data is correct in the Together UI"
echo "   2. Review logs for any errors: docker compose logs server"
echo "   3. Test file uploads and message sending"
