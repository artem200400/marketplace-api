#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

BASE_STACK="${HW31_BASE_STACK:-dev}"

pulumi_login
pulumi -C infra/base stack select "$BASE_STACK"

mkdir -p evidence

ROLE_NAME="$(pulumi -C infra/base stack output teardownRoleName)"
POLICY_NAME="$(pulumi -C infra/base stack output teardownPolicyName)"
ROLE_ARN="$(pulumi -C infra/base stack output teardownRoleArn)"

ROLE_JSON="$(aws iam get-role --role-name "$ROLE_NAME" --output json)"
POLICY_JSON="$(
  aws iam get-role-policy     --role-name "$ROLE_NAME"     --policy-name "$POLICY_NAME"     --output json
)"

node -e '
  const role=JSON.parse(process.argv[1]);
  const policy=JSON.parse(process.argv[2]);
  console.log(JSON.stringify({
    role: role.Role,
    permissionPolicy: policy.PolicyDocument
  }, null, 2))
' "$ROLE_JSON" "$POLICY_JSON"   > evidence/iam.json

ALLOWED="$(
  aws iam simulate-principal-policy     --policy-source-arn "$ROLE_ARN"     --action-names ec2:DescribeVpcs     --context-entries ContextKeyName=aws:RequestedRegion,ContextKeyValues="$AWS_REGION",ContextKeyType=string     --query 'EvaluationResults[0].EvalDecision'     --output text
)"

DENIED="$(
  aws iam simulate-principal-policy     --policy-source-arn "$ROLE_ARN"     --action-names s3:DeleteBucket     --query 'EvaluationResults[0].EvalDecision'     --output text
)"

cat > evidence/iam.txt <<EOF
sim-allowed=$ALLOWED
sim-denied=$DENIED
EOF

cat evidence/iam.txt
