#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/hw31-common.sh"

DEMO_STACK="${HW31_DEMO_STACK:-dev}"

pulumi_login
pulumi -C infra/demo stack select "$DEMO_STACK"

DB_ID="$(pulumi -C infra/demo stack output dbIdentifier)"

wait_available() {
  while true; do
    status="$(
      aws rds describe-db-instances         --region "$AWS_REGION"         --db-instance-identifier "$DB_ID"         --query 'DBInstances[0].DBInstanceStatus'         --output text
    )"

    [ "$status" = "available" ] && return
    sleep 10
  done
}

wait_available

AZ_BEFORE="$(
  aws rds describe-db-instances     --region "$AWS_REGION"     --db-instance-identifier "$DB_ID"     --query 'DBInstances[0].AvailabilityZone'     --output text
)"

START="$(date +%s)"

aws rds reboot-db-instance   --region "$AWS_REGION"   --db-instance-identifier "$DB_ID"   --force-failover   >/dev/null

DEADLINE=$((START + 600))
AZ_AFTER="$AZ_BEFORE"

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS="$(
    aws rds describe-db-instances       --region "$AWS_REGION"       --db-instance-identifier "$DB_ID"       --query 'DBInstances[0].DBInstanceStatus'       --output text
  )"

  AZ_AFTER="$(
    aws rds describe-db-instances       --region "$AWS_REGION"       --db-instance-identifier "$DB_ID"       --query 'DBInstances[0].AvailabilityZone'       --output text
  )"

  if [ "$STATUS" = "available" ] && [ "$AZ_AFTER" != "$AZ_BEFORE" ]; then
    break
  fi

  sleep 10
done

END="$(date +%s)"
SECONDS=$((END - START))

EVENT="$(
  aws rds describe-events     --region "$AWS_REGION"     --source-type db-instance     --source-identifier "$DB_ID"     --duration 60     --query 'Events[-1].Message'     --output text
)"

set_evidence_key evidence/demos.txt az-before "$AZ_BEFORE"
set_evidence_key evidence/demos.txt az-after "$AZ_AFTER"
set_evidence_key evidence/demos.txt failover-seconds "$SECONDS"
set_evidence_key evidence/demos.txt event "$EVENT"

printf 'az-before=%s\naz-after=%s\nfailover-seconds=%s\nevent=%s\n'   "$AZ_BEFORE"   "$AZ_AFTER"   "$SECONDS"   "$EVENT"

[ "$AZ_BEFORE" != "$AZ_AFTER" ]
[ "$SECONDS" -ge 20 ]
[ "$SECONDS" -le 600 ]
