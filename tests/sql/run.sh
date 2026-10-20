#!/usr/bin/env bash
# Compatibility entry point; npm run test:sql is cross-platform.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec npx tsx tests/sql/run.ts
