#!/usr/bin/env bash
set -euo pipefail

CLUSTER="${KIND_CLUSTER_NAME:-marketplace-hw28}"
kind delete cluster --name "$CLUSTER"
