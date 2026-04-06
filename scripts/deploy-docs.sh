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

REMOTE_HOST="${1:-${REMOTE_HOST:-}}"
REMOTE_PATH="${REMOTE_PATH:-/var/www/docs.together-chat.com}"

if [ -z "$REMOTE_HOST" ]; then
  echo "Error: REMOTE_HOST not set and no argument provided."
  echo "Usage: $0 <user@host>"
  exit 1
fi

# StrictHostKeyChecking=accept-new auto-accepts unknown host keys on first connect (TOFU).
# For maximum security, pre-populate known_hosts and change to 'yes'.
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes)

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$SCRIPT_DIR/docs/site"

# Pre-flight checks
if ! command -v npx &>/dev/null; then
  echo "Error: npx not found. Install Node.js first."
  exit 1
fi

if [ ! -f "$DOCS_DIR/package.json" ]; then
  echo "Error: No package.json found in $DOCS_DIR."
  exit 1
fi

if [ ! -d "$DOCS_DIR/node_modules" ]; then
  echo "Error: node_modules not found. Run 'npm install' in $DOCS_DIR first."
  exit 1
fi

# Build
echo "→ Building docs site..."
cd "$DOCS_DIR"
npx vitepress build

# Verify build output
DIST="$DOCS_DIR/.vitepress/dist"

if [ ! -f "$DIST/index.html" ]; then
  echo "Error: Build output missing (no index.html in $DIST)."
  exit 1
fi

# Deploy
echo "→ Checking SSH connectivity to ${REMOTE_HOST}..."
if ! ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "true" 2>/dev/null; then
  echo "Error: Cannot connect to ${REMOTE_HOST} via SSH."
  echo "  - Ensure your SSH key is authorized on the server"
  echo "  - BatchMode=yes is set, so password auth is disabled"
  echo "  - Check: ssh ${REMOTE_HOST} 'echo ok'"
  exit 1
fi

echo "→ Uploading to ${REMOTE_HOST}:${REMOTE_PATH}..."

# Ensure remote directory exists (use sudo if direct mkdir fails)
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "mkdir -p '${REMOTE_PATH}' 2>/dev/null || sudo mkdir -p '${REMOTE_PATH}' && sudo chown \$(whoami):\$(whoami) '${REMOTE_PATH}'"

# rsync is better than scp for this (only sends changed files)
rsync -avz -e "ssh ${SSH_OPTS[*]}" --delete "$DIST/" "$REMOTE_HOST:${REMOTE_PATH}/"

echo "✓ Docs deployed to ${REMOTE_HOST}:${REMOTE_PATH}"
echo "  → https://docs.together-chat.com"
