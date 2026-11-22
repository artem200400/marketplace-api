#!/usr/bin/env bash
set -euo pipefail

ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
  pwd
)"

cd "$ROOT"

: "${AWS_REGION:=eu-central-1}"
export AWS_REGION

pulumi_login() {
  if [ -n "${PULUMI_BACKEND_URL:-}" ]; then
    pulumi login "$PULUMI_BACKEND_URL"
  else
    pulumi login
  fi
}

select_stack() {
  local dir="$1"
  local stack="$2"

  pulumi -C "$dir" stack select "$stack" --create
}

set_evidence_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  mkdir -p "$(dirname "$file")"
  touch "$file"

  tmp="$(mktemp)"
  grep -v "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
}
