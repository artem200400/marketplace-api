#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

DEMO_STACK="${HW31_DEMO_STACK:-dev}"

pulumi_login
pulumi -C infra/demo stack select "$DEMO_STACK"

ALB_DNS="$(pulumi -C infra/demo stack output albDns)"
TARGET_GROUP_ARN="$(pulumi -C infra/demo stack output targetGroupArn)"

HTTP_CODE=000
for _ in $(seq 1 30); do
  HTTP_CODE="$(
    curl -sS       -o /dev/null       -w '%{http_code}'       "http://$ALB_DNS/" || true
  )"

  [ "$HTTP_CODE" = "200" ] && break
  sleep 5
done

TARGET_STATE="$(
  aws elbv2 describe-target-health     --region "$AWS_REGION"     --target-group-arn "$TARGET_GROUP_ARN"     --query 'TargetHealthDescriptions[0].TargetHealth.State'     --output text
)"

set_evidence_key evidence/demos.txt alb-dns "$ALB_DNS"
set_evidence_key evidence/demos.txt http-code "$HTTP_CODE"
set_evidence_key evidence/demos.txt target-state "$TARGET_STATE"

printf 'alb-dns=%s\nhttp-code=%s\ntarget-state=%s\n'   "$ALB_DNS"   "$HTTP_CODE"   "$TARGET_STATE"

[ "$HTTP_CODE" = "200" ]
[ "$TARGET_STATE" = "healthy" ]
