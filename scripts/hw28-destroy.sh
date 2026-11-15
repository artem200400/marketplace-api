#!/usr/bin/env bash
set -euo pipefail

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${PULUMI_BACKEND_URL:?PULUMI_BACKEND_URL is required}"
: "${PULUMI_CONFIG_PASSPHRASE:?PULUMI_CONFIG_PASSPHRASE is required}"

cd infra
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack select dev
pulumi destroy --yes --non-interactive
