#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

DEMO_STACK="${HW31_DEMO_STACK:-dev}"

pulumi_login
pulumi -C infra/demo stack select "$DEMO_STACK"

pulumi -C infra/demo destroy   --yes   --non-interactive
