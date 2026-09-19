#!/usr/bin/env bash
# Download MobileSAM weights (~40 MB) into ../weights/
set -euo pipefail
mkdir -p "$(dirname "$0")/../weights"
curl -L -o "$(dirname "$0")/../weights/mobile_sam.pt" \
  https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/weights/mobile_sam.pt
