#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

DEMO_STACK="${HW31_DEMO_STACK:-dev}"

pulumi_login
pulumi -C infra/demo stack select "$DEMO_STACK"

START="$(date +%s)"

pulumi -C infra/demo config set withNat true
pulumi -C infra/demo up   --yes   --non-interactive

NAT_ID="$(pulumi -C infra/demo stack output natGatewayId)"

[ -n "$NAT_ID" ]

pulumi -C infra/demo config set withNat false
pulumi -C infra/demo up   --yes   --non-interactive

END="$(date +%s)"
ELAPSED=$((END - START))
MINUTES=$(((ELAPSED + 59) / 60))
BILLED_HOURS=$(((MINUTES + 59) / 60))

set_evidence_key evidence/demos.txt nat-minutes "$MINUTES"
set_evidence_key evidence/demos.txt nat-billed-hours "$BILLED_HOURS"

printf 'nat-minutes=%s\nnat-billed-hours=%s\n'   "$MINUTES"   "$BILLED_HOURS"

[ "$MINUTES" -lt 60 ]
[ "$BILLED_HOURS" -eq 1 ]
