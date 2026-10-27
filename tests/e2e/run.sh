#!/usr/bin/env bash
# Restarts the mock gateway (fresh database) and runs the browser acceptance suite.
# Expects `next start` on :3000 built with NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321.
set -u
cd "$(dirname "$0")/../.."
pkill -f "^node tests/e2e/mock-supabase.mjs" 2>/dev/null
sleep 0.5
setsid node tests/e2e/mock-supabase.mjs > /tmp/mock-supabase.log 2>&1 &
for i in $(seq 1 40); do grep -q "mock supabase on" /tmp/mock-supabase.log 2>/dev/null && break; sleep 0.25; done
node tests/e2e/acceptance.e2e.mjs
