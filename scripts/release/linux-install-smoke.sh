#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo 'Usage: linux-install-smoke.sh <AppImage> <x86_64|aarch64> [log-directory]' >&2
  exit 2
fi

appimage="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
arch="$2"
log_dir="${3:-smoke-logs}"
mkdir -p "$log_dir"
log_dir="$(cd "$log_dir" && pwd)"
work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/wae-linux-smoke.XXXXXX")"
install_dir="$work_dir/install/.local/bin"
session_pid=''

cleanup() {
  if [[ -n "$session_pid" ]] && kill -0 "$session_pid" 2>/dev/null; then
    kill -TERM -- "-$session_pid" 2>/dev/null || true
    sleep 2
    kill -KILL -- "-$session_pid" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

[[ -f "$appimage" ]] || { echo "AppImage does not exist: $appimage" >&2; exit 1; }
[[ "$arch" == x86_64 || "$arch" == aarch64 ]] || { echo "Unsupported Linux architecture: $arch" >&2; exit 2; }

file_description="$(file -b "$appimage")"
case "$arch" in
  x86_64) grep -Eqi 'x86[-_ ]64|x86-64' <<<"$file_description" || { echo "ELF architecture mismatch: $file_description" >&2; exit 1; } ;;
  aarch64) grep -Eqi 'aarch64|ARM aarch64' <<<"$file_description" || { echo "ELF architecture mismatch: $file_description" >&2; exit 1; } ;;
esac

mkdir -p "$install_dir"
installed_appimage="$install_dir/wps-agent-editor.AppImage"
cp "$appimage" "$installed_appimage"
chmod 0755 "$installed_appimage"

extract_dir="$work_dir/extracted"
mkdir -p "$extract_dir"
(
  cd "$extract_dir"
  "$installed_appimage" --appimage-extract >/dev/null
)
app_run="$extract_dir/squashfs-root/AppRun"
[[ -x "$app_run" ]] || { echo 'AppImage extraction did not produce an executable AppRun' >&2; exit 1; }
node "$(dirname "$0")/inspect-installed-smoke.mjs" --root "$extract_dir/squashfs-root"
association_report="$log_dir/linux-$arch-associations.json"
node "$(dirname "$0")/verify-bundle-associations.mjs" \
  --platform linux \
  --root "$extract_dir/squashfs-root" \
  --report "$association_report"
node "$(dirname "$0")/run-installed-core-smoke.mjs" \
  --platform linux \
  --executable "$app_run" \
  --report "$log_dir/linux-$arch-core-smoke.json"

launch_log="$log_dir/linux-$arch-launch.log"
setsid dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24' \
  env NO_AT_BRIDGE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 "$app_run" >"$launch_log" 2>&1 &
session_pid=$!
sleep 15
if ! kill -0 "$session_pid" 2>/dev/null; then
  wait "$session_pid" || exit_code=$?
  echo "Extracted AppImage exited during the 15-second startup observation (exit ${exit_code:-unknown})" >&2
  cat "$launch_log" >&2
  exit 1
fi
kill -TERM -- "-$session_pid" 2>/dev/null || true
wait "$session_pid" || true
session_pid=''

rm -f "$installed_appimage"
rm -rf "$extract_dir"
[[ ! -e "$installed_appimage" && ! -e "$extract_dir" ]] || {
  echo 'AppImage uninstall cleanup left installed or extracted files behind' >&2
  exit 1
}

cat >"$log_dir/linux-$arch-install-smoke.json" <<EOF
{
  "schemaVersion": 1,
  "platform": "linux",
  "arch": "$arch",
  "appImage": "$(basename "$appimage")",
  "fileDescription": "${file_description//\"/\\\"}",
  "extractAndRunVerified": true,
  "associationMetadataVerified": true,
  "associationReport": "$(basename "$association_report")",
  "startupObservationSeconds": 15,
  "uninstallVerified": true
}
EOF
echo "Linux AppImage install/extract/start/remove smoke passed for $arch"
