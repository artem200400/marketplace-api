#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

BASE_STACK="${HW31_BASE_STACK:-dev}"
DEMO_STACK="${HW31_DEMO_STACK:-dev}"

pulumi_login

pulumi -C infra/demo stack select "$DEMO_STACK"
pulumi -C infra/demo destroy   --yes   --non-interactive

pulumi -C infra/base stack select "$BASE_STACK"
pulumi -C infra/base destroy   --yes   --non-interactive

DEMO_STATE="$(
  pulumi -C infra/demo stack export
)"

BASE_STATE="$(
  pulumi -C infra/base stack export
)"

STATE_RESOURCES_LEFT="$(
  node -e '
    const states=[
      JSON.parse(process.argv[1]),
      JSON.parse(process.argv[2])
    ];
    let count=0;
    for(const state of states){
      for(const r of state.deployment?.resources||[]){
        if(
          typeof r.type==="string" &&
          r.type.startsWith("aws:")
        ){
          count+=1;
        }
      }
    }
    console.log(count);
  ' "$DEMO_STATE" "$BASE_STATE"
)"

sum_region_query() {
  local service="$1"
  shift
  local total=0
  local region
  local value

  for region in "$AWS_REGION"; do
    value="$(
      aws "$service" "$@"         --region "$region"         --output text
    )"

    total=$((total + value))
  done

  printf '%s\n' "$total"
}

TAGGED_RESOURCES_LEFT=0
for region in "$AWS_REGION"; do
  value="$(
    aws resourcegroupstaggingapi get-resources       --region "$region"       --tag-filters Key=Project,Values=nodejs-pro-hw31       --query 'length(ResourceTagMappingList)'       --output text
  )"

  TAGGED_RESOURCES_LEFT=$((TAGGED_RESOURCES_LEFT + value))
done

RDS_LEFT="$(
  sum_region_query     rds     describe-db-instances     --query 'length(DBInstances)'
)"

ALB_LEFT="$(
  sum_region_query     elbv2     describe-load-balancers     --query 'length(LoadBalancers)'
)"

NAT_LEFT=0
for region in "$AWS_REGION"; do
  value="$(
    aws ec2 describe-nat-gateways       --region "$region"       --filter Name=state,Values=available       --query 'length(NatGateways)'       --output text
  )"

  NAT_LEFT=$((NAT_LEFT + value))
done

EIP_LEFT="$(
  sum_region_query     ec2     describe-addresses     --query 'length(Addresses)'
)"

printf 'state-resources-left=%s\n' "$STATE_RESOURCES_LEFT"
printf 'tagged-resources-left=%s\n' "$TAGGED_RESOURCES_LEFT"
printf 'rds-left=%s\n' "$RDS_LEFT"
printf 'alb-left=%s\n' "$ALB_LEFT"
printf 'nat-left=%s\n' "$NAT_LEFT"
printf 'eip-left=%s\n' "$EIP_LEFT"

[ "$STATE_RESOURCES_LEFT" -eq 0 ]
[ "$TAGGED_RESOURCES_LEFT" -eq 0 ]
[ "$RDS_LEFT" -eq 0 ]
[ "$ALB_LEFT" -eq 0 ]
[ "$NAT_LEFT" -eq 0 ]
[ "$EIP_LEFT" -eq 0 ]
