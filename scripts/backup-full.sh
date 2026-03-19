#!/usr/bin/env bash
# Full backup of Together — PostgreSQL database + file uploads.
# Usage: ./scripts/backup-full.sh [backup_dir]
#
# This script creates:
# - together_YYYYMMDD_HHMMSS.sql.gz (database dump)
# - uploads_YYYYMMDD_HHMMSS.tar.gz (file uploads)
#
# Reads POSTGRES_USER and POSTGRES_DB from .env (if present) or the environment.
# Requires services to be running: docker compose up -d
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if present (production values)
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +o allexport
fi

BACKUP_DIR="${1:-$ROOT_DIR/backups}"
POSTGRES_USER="${POSTGRES_USER:-together}"
POSTGRES_DB="${POSTGRES_DB:-together_prod}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_BACKUP_FILE="$BACKUP_DIR/together_${TIMESTAMP}.sql.gz"
UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_${TIMESTAMP}.tar.gz"
TMP_DB_FILE="$BACKUP_DIR/.backup_db_${TIMESTAMP}.tmp"
TMP_UPLOADS_FILE="$BACKUP_DIR/.backup_uploads_${TIMESTAMP}.tmp"

mkdir -p "$BACKUP_DIR"

# Clean up temp files on any exit (success or failure)
trap 'rm -f "$TMP_DB_FILE" "$TMP_UPLOADS_FILE"' EXIT

echo "🐘 Together Full Backup"
echo "======================="
echo "Backup directory: $BACKUP_DIR"
echo "Timestamp: $TIMESTAMP"
echo ""

# 1. Backup PostgreSQL database
echo "📦 Backing up database '$POSTGRES_DB'..."
docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$TMP_DB_FILE"

# pg_dump and gzip both succeeded — atomically move to final name
mv "$TMP_DB_FILE" "$DB_BACKUP_FILE"
DB_SIZE=$(du -h "$DB_BACKUP_FILE" | cut -f1)
echo "   ✅ Database backup: $DB_BACKUP_FILE ($DB_SIZE)"
trap 'rm -f "$TMP_UPLOADS_FILE"' EXIT

# 2. Backup file uploads
echo "📦 Backing up file uploads..."
docker run --rm -v together_uploads_data:/data -v "$(pwd)/backups":/backup \
  alpine tar czf "$TMP_UPLOADS_FILE" -C /data .

# Archive succeeded — atomically move to final name
mv "$TMP_UPLOADS_FILE" "$UPLOADS_BACKUP_FILE"
UPLOADS_SIZE=$(du -h "$UPLOADS_BACKUP_FILE" | cut -f1)
echo "   ✅ Uploads backup: $UPLOADS_BACKUP_FILE ($UPLOADS_SIZE)"

# 3. Summary
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "✨ Backup complete!"
echo "   Total backup size: $TOTAL_SIZE"
echo "   Database: $DB_BACKUP_FILE"
echo "   Uploads: $UPLOADS_BACKUP_FILE"
echo ""
echo "💡 Verify backups with:"
echo "   gunzip -t $DB_BACKUP_FILE"
echo "   tar tzf $UPLOADS_BACKUP_FILE > /dev/null"
