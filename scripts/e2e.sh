#!/usr/bin/env bash
# Build web/dist-e2e (DuckDB bundled, like Tauri, so the tests run offline; the web build loads it
# from jsDelivr) and run the headless smoke test and the question-panel test against it.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${E2E_PORT:-4179}
(cd web && DUCKDB_LOCAL=1 npx vite build --outDir dist-e2e --emptyOutDir >/dev/null)
(cd web && npx vite preview --outDir dist-e2e --port "$PORT" --strictPort >/dev/null 2>&1) &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf "http://localhost:$PORT" >/dev/null && break; sleep 0.2; done
cd web
export BASE_URL="http://localhost:$PORT" NODE_PATH="${NODE_PATH:-$(npm root -g)}"
node e2e/smoke.mjs
node e2e/agent.mjs  # #11 question panel (rules agent)
