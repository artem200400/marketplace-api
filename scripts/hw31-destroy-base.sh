#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

BASE_STACK="${HW31_BASE_STACK:-dev}"

pulumi_login
pulumi -C infra/base stack select "$BASE_STACK"

pulumi -C infra/base destroy   --yes   --non-interactive
