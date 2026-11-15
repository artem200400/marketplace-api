#!/usr/bin/env bash
set -euo pipefail

CLUSTER="${KIND_CLUSTER_NAME:-marketplace-hw28}"
IMAGE="${APP_IMAGE:-marketplace-api:hw28}"

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  kind create cluster     --name "$CLUSTER"     --config k8s/kind-config.yaml
fi

kind load docker-image   "$IMAGE"   --name "$CLUSTER"

kubectl cluster-info   --context "kind-$CLUSTER" >/dev/null
