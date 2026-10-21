#!/bin/sh
# One command on the host: install if needed, preflight, start.   (then open http://localhost:5010/api/health)
set -e
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci
npm run doctor
exec npm start
