#!/bin/bash
# Build and deploy the Together docs site to the server.
#
# Usage:
#   ./scripts/deploy-docs.sh                    # uses REMOTE_HOST from env
#   ./scripts/deploy-docs.sh docs@myserver.io   # explicit host
#
# Requires:
#   - ssh access to the server (key auth)
#   - The remote path /var/www/docs.together-chat.com should exist
#     (or wherever your nginx serves docs from)

set -euo pipefail

REMOTE_HOST="${1:-$REMOTE_HOST}"
REMOTE_PATH="${REMOTE_PATH:-/var/www/docs.together-chat.com}"

if [ -z "$REMOTE_HOST" ]; then
  echo "Error: REMOTE_HOST not set and no argument provided."
  echo "Usage: $0 <user@host>"
  exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=accept-new -o BatchMode=yes"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$SCRIPT_DIR/docs/site"

# Build
echo "→ Building docs site..."
cd "$DOCS_DIR"
npx vitepress build

# Deploy
DIST="$DOCS_DIR/.vitepress/dist"

echo "→ Uploading to ${REMOTE_HOST}:${REMOTE_PATH}..."

# Ensure remote directory exists
ssh "$SSH_OPTS" "$REMOTE_HOST" "mkdir -p ${REMOTE_PATH}"

# rsync is better than scp for this (only sends changed files)
rsync -avz -e "ssh $SSH_OPTS" --delete "$DIST/" "$REMOTE_HOST:${REMOTE_PATH}/"

echo "✓ Docs deployed to ${REMOTE_HOST}:${REMOTE_PATH}"
echo "  → https://docs.together-chat.com"
