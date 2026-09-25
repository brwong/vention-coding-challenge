#!/usr/bin/env bash
# Convenience script for local development and manual testing: starts five
# pendulum nodes and the web UI, all as background jobs of this shell.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_COUNT=5
UI_PORT=5173

# Build once up front rather than letting each `npm start` run its own
# `prestart` build concurrently, which would race on the shared dist/ output.
echo "Building nodes..."
npm --prefix "$ROOT_DIR/nodes" run build

pids=()

cleanup() {
  echo
  echo "Stopping demo..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM

for ((i = 0; i < NODE_COUNT; i++)); do
  node "$ROOT_DIR/nodes/dist/index.js" &
  pids+=("$!")
done

npm --prefix "$ROOT_DIR/web" run dev &
pids+=("$!")

echo
echo "Web UI: http://localhost:$UI_PORT"
echo "Press Ctrl+C to stop all nodes and the web UI."

wait
