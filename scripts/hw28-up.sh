#!/usr/bin/env bash
set -euo pipefail

normalize_backend_url() {
  local raw="$1"

  if [[ "$raw" == file://* ]]; then
    local path="${raw#file://}"

    if command -v cygpath >/dev/null 2>&1 && [[ "$path" == /[A-Za-z]/* ]]; then
      local win
      win="$(cygpath -w "$path")"
      win="${win//\\//}"
      printf 'file:///%s\n' "$win"
      return
    fi

    mkdir -p "$path"
  fi

  printf '%s\n' "$raw"
}

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${PULUMI_BACKEND_URL:?PULUMI_BACKEND_URL is required}"
: "${PULUMI_CONFIG_PASSPHRASE:?PULUMI_CONFIG_PASSPHRASE is required}"

BACKEND_URL="$(normalize_backend_url "$PULUMI_BACKEND_URL")"

if [[ "$BACKEND_URL" == file:///* ]]; then
  backend_path="${BACKEND_URL#file:///}"

  if command -v cygpath >/dev/null 2>&1 && [[ "$backend_path" =~ ^[A-Za-z]:/ ]]; then
    mkdir -p "$(cygpath -u "$backend_path")"
  else
    mkdir -p "/$backend_path"
  fi
fi

cd infra
pulumi login "$BACKEND_URL"
pulumi stack select dev --create
pulumi up --yes --non-interactive
