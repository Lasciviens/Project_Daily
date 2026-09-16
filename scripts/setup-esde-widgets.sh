#!/data/data/com.termux/files/usr/bin/bash
# Run once from the SD card's Download folder. Secrets stay in Termux private storage.
set -euo pipefail
umask 077
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$HOME/.local/share/esde-sync"
config_dir="$HOME/.config/esde-sync"
card='/storage/6A0A-D741'
test -r "$card/ES-DE/gamelists/nes/gamelist.xml" || {
  echo 'SD kart okunamiyor. Depolama iznini ve karti kontrol et.'; exit 1;
}
for script in push-esde-library.py sync-esde.py sync-esde-content.py; do
  test -f "$source_dir/$script" || { echo "Eksik dosya: $script"; exit 1; }
done
if ! python -c 'from PIL import Image' >/dev/null 2>&1; then
  pkg install -y python python-pillow
fi
mkdir -p "$app_dir" "$config_dir" "$HOME/.shortcuts"
chmod 700 "$config_dir" "$HOME/.shortcuts"
cp "$source_dir/push-esde-library.py" "$source_dir/sync-esde.py" "$source_dir/sync-esde-content.py" "$app_dir/"
# Also update the original manual command so both paths use the same filters/state.
cp "$source_dir/push-esde-library.py" "$HOME/push-esde-library.py"
cat > "$config_dir/config.json" <<'JSON'
{"url":"https://hsaedwwqpcjizeozjbch.supabase.co","gamelists":"/storage/6A0A-D741/ES-DE/gamelists","roms":"/storage/6A0A-D741/ROMs","media":"/storage/6A0A-D741/ES-DE/downloaded_media"}
JSON
if [ ! -s "$config_dir/secret" ]; then
  if [ -z "${ESDE_SYNC_SECRET:-}" ]; then
    read -r -s -p 'ESDE_SYNC_SECRET (yalnizca ilk kurulum): ' ESDE_SYNC_SECRET
    echo
  fi
  test -n "$ESDE_SYNC_SECRET" || { echo 'Secret bos olamaz.'; exit 1; }
  printf '%s' "$ESDE_SYNC_SECRET" > "$config_dir/secret"
fi
chmod 600 "$config_dir/secret" "$config_dir/config.json"
create_widget() {
  local filename="$1" option="$2" script="${3:-sync-esde-content.py}"
  cat > "$HOME/.shortcuts/$filename" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
echo 'ES-DE kapali olmali. Senkronizasyon basliyor...'
command -v termux-wake-lock >/dev/null && termux-wake-lock
trap 'command -v termux-wake-unlock >/dev/null && termux-wake-unlock' EXIT
SH
  printf 'python "$HOME/.local/share/esde-sync/%s" %s\n' "$script" "$option" >> "$HOME/.shortcuts/$filename"
  cat >> "$HOME/.shortcuts/$filename" <<'SH'
result=$?
if [ "$result" -ne 0 ]; then
  echo 'Tamamlanamadi. Yukaridaki hataya bak; tekrar calistirinca kaldigi yerden devam eder.'
fi
read -r -p 'Kapatmak icin Enter...' _
exit "$result"
SH
  chmod 700 "$HOME/.shortcuts/$filename"
}
create_widget 'Oyunlari-Senkronize-Et' ''
create_widget 'Kapaklari-Guncelle' '--covers-only' 'sync-esde.py'
create_widget 'Gorselleri-Senkronize-Et' '--media-only'
create_widget 'Metadatayi-Senkronize-Et' '--metadata-only'
create_widget 'Kutuphane-Kontrol' '--dry-run'
python "$app_dir/sync-esde-content.py" --dry-run
echo 'Hazir. Ana ekrana Termux widget ekle ve Oyunlari-Senkronize-Et sec.'
