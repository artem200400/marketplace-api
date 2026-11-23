#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

BASE_STACK="${HW31_BASE_STACK:-dev}"

pulumi_login
pulumi -C infra/base stack select "$BASE_STACK"

mkdir -p evidence

VPC_ID="$(pulumi -C infra/base stack output vpcId)"
PUBLIC_JSON="$(pulumi -C infra/base stack output publicSubnetIds --json)"
PRIVATE_JSON="$(pulumi -C infra/base stack output privateSubnetIds --json)"
PRIVATE_RT="$(pulumi -C infra/base stack output privateRouteTableId)"

PUBLIC_IDS="$(node -e 'const a=JSON.parse(process.argv[1]); console.log(a.join(" "))' "$PUBLIC_JSON")"
PRIVATE_IDS="$(node -e 'const a=JSON.parse(process.argv[1]); console.log(a.join(" "))' "$PRIVATE_JSON")"

SUBNETS_JSON="$(
  aws ec2 describe-subnets     --region "$AWS_REGION"     --subnet-ids $PUBLIC_IDS $PRIVATE_IDS     --output json
)"

SUBNET_AZS="$(
  node -e '
    const x=JSON.parse(process.argv[1]);
    console.log(new Set((x.Subnets||[]).map(s=>s.AvailabilityZone)).size)
  ' "$SUBNETS_JSON"
)"

PRIVATE_ROUTES_JSON="$(
  aws ec2 describe-route-tables     --region "$AWS_REGION"     --route-table-ids "$PRIVATE_RT"     --output json
)"

PRIVATE_DEFAULT_ROUTE="$(
  node -e '
    const x=JSON.parse(process.argv[1]);
    const n=(x.RouteTables||[])
      .flatMap(t=>t.Routes||[])
      .filter(r=>r.DestinationCidrBlock==="0.0.0.0/0")
      .length;
    console.log(n)
  ' "$PRIVATE_ROUTES_JSON"
)"

SECURITY_GROUPS="$(
  aws ec2 describe-security-groups     --region "$AWS_REGION"     --filters       "Name=vpc-id,Values=$VPC_ID"       "Name=tag:Project,Values=nodejs-pro-hw31"     --query 'length(SecurityGroups)'     --output text
)"

TAGGED_RESOURCES="$(
  aws resourcegroupstaggingapi get-resources     --region "$AWS_REGION"     --tag-filters Key=Project,Values=nodejs-pro-hw31     --query 'length(ResourceTagMappingList)'     --output text
)"

cat > evidence/base.txt <<EOF
vpc-id=$VPC_ID
public-subnets=$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$PUBLIC_JSON")
private-subnets=$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$PRIVATE_JSON")
subnet-azs=$SUBNET_AZS
private-default-route=$PRIVATE_DEFAULT_ROUTE
security-groups=$SECURITY_GROUPS
tagged-resources=$TAGGED_RESOURCES
EOF

pulumi -C infra/base stack export   > evidence/base-state.json

cat evidence/base.txt
