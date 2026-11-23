#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

: "${HW31_BASE_STACK_REF:?HW31_BASE_STACK_REF is required, e.g. org/marketplace-hw31-base/dev}"
: "${HW31_DB_PASSWORD:?HW31_DB_PASSWORD is required}"

DEMO_STACK="${HW31_DEMO_STACK:-dev}"

pulumi_login
select_stack "infra/demo" "$DEMO_STACK"

pulumi -C infra/demo config set baseStackRef "$HW31_BASE_STACK_REF"
pulumi -C infra/demo config set dbPassword "$HW31_DB_PASSWORD" --secret
pulumi -C infra/demo config set withNat false

pulumi -C infra/demo up   --yes   --non-interactive
