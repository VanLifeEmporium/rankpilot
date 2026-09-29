#!/bin/bash
# Release 19: production start. Migrate once, then run the web app and the compiled worker
# with plain node and a heap limit each. bash supervises (a node supervisor cost ~45 MB).
set -euo pipefail
if [ "${DEMO_MODE:-}" != "true" ] && { [ -z "${ENCRYPTION_KEY:-}" ] || [ -z "${SESSION_SECRET:-}" ] || [ -z "${SHOPIFY_API_KEY:-}" ] || [ -z "${SHOPIFY_API_SECRET:-}" ]; }; then
  echo "Production secrets are missing" >&2; exit 1
fi
if [ "${SKIP_MIGRATE:-}" != "true" ]; then node node_modules/prisma/build/index.js migrate deploy; fi
node --max-old-space-size="${WEB_HEAP_MB:-180}" node_modules/@react-router/serve/bin.js ./build/server/index.js &
WEB=$!
node --max-old-space-size="${WORKER_HEAP_MB:-200}" build/worker/worker.mjs &
WORKER=$!
trap 'kill -TERM $WEB $WORKER 2>/dev/null' TERM INT
set +e
wait -n $WEB $WORKER
STATUS=$?
kill -TERM $WEB $WORKER 2>/dev/null
wait
exit $STATUS
