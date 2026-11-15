#!/usr/bin/env bash
set -euo pipefail

IMAGE="${APP_IMAGE:-marketplace-api:hw28}"
TOKEN_FILE="${NPM_TOKEN_FILE:-.npm_token}"

if [[ ! -s "$TOKEN_FILE" ]]; then
  echo "Missing build secret file: $TOKEN_FILE" >&2
  exit 1
fi

DOCKER_BUILDKIT=1 docker build   --secret id=npm_token,src="$TOKEN_FILE"   -t "$IMAGE"   -f docker/Dockerfile   .
