#!/usr/bin/env bash
# Kobo Phase 0 device report (docs/kobo/PLAN.md §10.6). READ-ONLY: it never
# writes to the device. Prints no titles and no reading data, so the output
# can be pasted into a chat.
#
# Usage (Mac, Kobo plugged in and "Connect" tapped):
#   bash scripts/kobo/device-report.sh [/Volumes/KOBOeReader]
set -euo pipefail

KOBO="${1:-/Volumes/KOBOeReader}"
if [ ! -d "$KOBO/.kobo" ]; then
  echo "No Kobo found at $KOBO (no .kobo folder). Plug it in, tap Connect, or pass the mount path." >&2
  exit 1
fi

echo "== Kobo device report =="

# .kobo/version: serial,?,firmware,?,?,product-id — the serial is left out.
if [ -f "$KOBO/.kobo/version" ]; then
  IFS=',' read -r _serial _a firmware _b _c product < "$KOBO/.kobo/version" || true
  product="${product##*-}"
  case "$product" in
    391|*0391) model="Clara BW (N365, product 391)" ;;
    395|*0395) model="Clara BW (P365, product 395)" ;;
    *) model="unknown product id: $product" ;;
  esac
  echo "Firmware:      ${firmware:-unknown}"
  echo "Model:         $model"
  case "${firmware:-}" in
    5.*|6.*) echo "!! Firmware is 5.x/6.x — STOP and report before installing anything (PLAN.md §1.1)." ;;
  esac
else
  echo "Firmware:      .kobo/version not found"
fi

echo "Free space:    $(df -h "$KOBO" | awk 'NR==2 {print $4 " free of " $2}')"

count() { find "$KOBO" -path "$KOBO/.*" -prune -o -type f -iname "$1" -print 2>/dev/null | wc -l | tr -d ' '; }
kepub=$(count '*.kepub.epub')
epub_all=$(count '*.epub')
echo "Books:         $((epub_all - kepub)) epub · $kepub kepub · $(count '*.pdf') pdf"

KO="$KOBO/.adds/koreader"
if [ -d "$KO" ]; then
  ver="$(cat "$KO/git-rev" 2>/dev/null || echo 'installed, version file not found')"
  echo "KOReader:      $ver"
  [ -f "$KO/data/ca-bundle.crt" ] && echo "CA bundle:     present" || echo "CA bundle:     missing"
  [ -f "$KO/settings/statistics.sqlite3" ] && echo "Statistics DB: present" || echo "Statistics DB: not yet (read a book in KOReader first)"
else
  echo "KOReader:      not installed"
fi

[ -d "$KOBO/.adds/nm" ] && echo "NickelMenu:    config folder present" || echo "NickelMenu:    not installed"
[ -d "$KOBO/.adds/kfmon" ] && echo "KFMon:         present" || echo "KFMon:         not installed"
grep -q '^ExcludeSyncFolders' "$KOBO/.kobo/Kobo/Kobo eReader.conf" 2>/dev/null \
  && echo "ExcludeSync:   set" || echo "ExcludeSync:   not set"
