#!/usr/bin/env bash
# Backs up the Together PostgreSQL database to a compressed SQL dump.
# Usage: ./scripts/backup.sh [backup_dir]
#
# Reads POSTGRES_USER and POSTGRES_DB from .env (if present) or the environment.
# Requires the postgres container to be running: docker compose up -d postgres
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
BACKUP_FILE="$BACKUP_DIR/together_${TIMESTAMP}.sql.gz"
TMP_FILE="$BACKUP_DIR/.backup_${TIMESTAMP}.tmp"

mkdir -p "$BACKUP_DIR"

# Clean up temp file on any exit (success or failure).
trap 'rm -f "$TMP_FILE"' EXIT

echo "Backing up '$POSTGRES_DB' → $BACKUP_FILE ..."
docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$TMP_FILE"

# pg_dump and gzip both succeeded — atomically move to final name.
mv "$TMP_FILE" "$BACKUP_FILE"
trap - EXIT

echo "Done. $(du -h "$BACKUP_FILE" | cut -f1)"
