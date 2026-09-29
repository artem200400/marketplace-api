#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
    cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
    pwd
)"

cd "$ROOT"

ENV_SLUG="${1:-dev}"
shift || true

[ "$#" -gt 0 ] || set -- npm run start

# Grader/CI already provides DB_* variables in the environment.
if [ "${SKIP_VAULT:-0}" = "1" ]; then
    exec "$@"
fi

CREDS="$ROOT/.secrets/infisical.env"

if [ ! -f "$CREDS" ]; then
    echo "Missing $CREDS"
    echo "Create the local Infisical credentials file first."
    exit 1
fi

set -a
source "$CREDS"
set +a

if ! command -v infisical >/dev/null 2>&1; then
    echo "Infisical CLI is not installed."
    exit 1
fi

exec infisical run \
    --env="$ENV_SLUG" \
    -- "$@"