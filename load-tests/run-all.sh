#!/usr/bin/env bash
# ============================================================
# Together Load Test Runner
# Runs all k6 load tests against a local or remote instance
# and writes results to load-tests/results/
#
# Usage:
#   ./load-tests/run-all.sh                   # local, 500 VUs, 3m
#   BASE_URL=http://my-server:8080 ./load-tests/run-all.sh
#   VU_COUNT=100 DURATION=1m ./load-tests/run-all.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
mkdir -p "${RESULTS_DIR}"

BASE_URL="${BASE_URL:-http://localhost:8080}"
WS_URL="${WS_URL:-ws://localhost:8080/ws}"
VU_COUNT="${VU_COUNT:-500}"
DURATION="${DURATION:-3m}"
RAMP_DURATION="${RAMP_DURATION:-30s}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

export BASE_URL WS_URL VU_COUNT DURATION RAMP_DURATION

echo "============================================"
echo " Together 500-User Load Test Suite"
echo " BASE_URL    : ${BASE_URL}"
echo " VU_COUNT    : ${VU_COUNT}"
echo " DURATION    : ${DURATION}"
echo " RESULTS_DIR : ${RESULTS_DIR}"
echo " TIMESTAMP   : ${TIMESTAMP}"
echo "============================================"
echo ""

# ── Health check ─────────────────────────────────────────────────────────────
echo "[0/3] Verifying server is reachable..."
for i in $(seq 1 10); do
  if curl -sf "${BASE_URL}/health" > /dev/null 2>&1; then
    echo "  ✓ Server is up"
    break
  fi
  if [ "${i}" -eq 10 ]; then
    echo "  ✗ Server unreachable after 10 attempts. Aborting."
    exit 1
  fi
  echo "  Waiting for server... (attempt ${i}/10)"
  sleep 3
done
echo ""

# ── Test 1: HTTP (messaging, auth, browsing) ─────────────────────────────────
echo "[1/3] Running HTTP load test (${VU_COUNT} VUs, sustain ${DURATION})..."
k6 run \
  --out json="${RESULTS_DIR}/http_${TIMESTAMP}.json" \
  --summary-export="${RESULTS_DIR}/http_summary_${TIMESTAMP}.json" \
  "${SCRIPT_DIR}/test-http.js" \
  2>&1 | tee "${RESULTS_DIR}/http_${TIMESTAMP}.log"
echo ""
echo "  ✓ HTTP test complete"
echo ""

# ── Test 2: WebSocket (presence + typing indicators) ─────────────────────────
echo "[2/3] Running WebSocket load test (${VU_COUNT} persistent connections)..."
k6 run \
  --out json="${RESULTS_DIR}/ws_${TIMESTAMP}.json" \
  --summary-export="${RESULTS_DIR}/ws_summary_${TIMESTAMP}.json" \
  "${SCRIPT_DIR}/test-websocket.js" \
  2>&1 | tee "${RESULTS_DIR}/ws_${TIMESTAMP}.log"
echo ""
echo "  ✓ WebSocket test complete"
echo ""

# ── Test 3: Voice signaling ──────────────────────────────────────────────────
echo "[3/3] Running Voice signaling load test..."
k6 run \
  --out json="${RESULTS_DIR}/voice_${TIMESTAMP}.json" \
  --summary-export="${RESULTS_DIR}/voice_summary_${TIMESTAMP}.json" \
  "${SCRIPT_DIR}/test-voice.js" \
  2>&1 | tee "${RESULTS_DIR}/voice_${TIMESTAMP}.log"
echo ""
echo "  ✓ Voice test complete"
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo "============================================"
echo " All tests complete. Results in: ${RESULTS_DIR}"
echo "============================================"
ls -lh "${RESULTS_DIR}/"*"${TIMESTAMP}"* 2>/dev/null || true
