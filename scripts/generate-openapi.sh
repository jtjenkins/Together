#!/usr/bin/env bash
# Generate the OpenAPI spec from Rust source annotations.
#
# Usage:
#   ./scripts/generate-openapi.sh          # writes docs/openapi.json
#   ./scripts/generate-openapi.sh --check  # exits non-zero if spec is stale
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPEC_PATH="$REPO_ROOT/docs/openapi.json"

cd "$REPO_ROOT/server"

echo "Building server..."
cargo build --quiet

echo "Generating OpenAPI spec..."
GENERATED=$("$REPO_ROOT/server/target/debug/together-server" --dump-openapi)

if [[ "${1:-}" == "--check" ]]; then
    if [[ ! -f "$SPEC_PATH" ]]; then
        echo "ERROR: $SPEC_PATH does not exist."
        echo "Run ./scripts/generate-openapi.sh to generate it."
        exit 1
    fi
    # Compare using jq --sort-keys to normalize JSON key ordering and whitespace.
    if ! diff -q \
        <(echo "$GENERATED" | jq --sort-keys .) \
        <(jq --sort-keys . "$SPEC_PATH") \
        > /dev/null 2>&1; then
        echo "ERROR: docs/openapi.json is out of date."
        echo "Run ./scripts/generate-openapi.sh to regenerate it."
        exit 1
    fi
    echo "docs/openapi.json is up to date."
else
    mkdir -p "$(dirname "$SPEC_PATH")"
    echo "$GENERATED" > "$SPEC_PATH"
    echo "Wrote $SPEC_PATH"
fi
