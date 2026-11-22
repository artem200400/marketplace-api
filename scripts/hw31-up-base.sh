#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

: "${HW31_BUDGET_EMAIL:?HW31_BUDGET_EMAIL is required}"

BASE_STACK="${HW31_BASE_STACK:-dev}"

pulumi_login
select_stack "infra/base" "$BASE_STACK"

pulumi -C infra/base config set budgetEmail "$HW31_BUDGET_EMAIL"

pulumi -C infra/base up   --yes   --non-interactive
