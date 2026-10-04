#!/usr/bin/env bash
# Copies lascisboard.koplugin to the Kobo over SSH (docs/kobo/PLAN.md §10.5).
# KOReader must be running with its SSH server on (Host "kobo" in ~/.ssh/config).
# Restart KOReader afterwards so it loads the new code.
#   bash scripts/kobo/deploy-plugin.sh
set -euo pipefail
cd "$(dirname "$0")"
DEST=/mnt/onboard/.adds/koreader/plugins/lascisboard.koplugin
ssh kobo "mkdir -p '$DEST'"
COPYFILE_DISABLE=1 scp -q lascisboard.koplugin/*.lua "kobo:$DEST/"
ssh kobo "ls -la '$DEST'"
echo "Copied. Restart KOReader to load it."
