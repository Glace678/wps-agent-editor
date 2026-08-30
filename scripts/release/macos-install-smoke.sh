#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 || $# -gt 5 ]]; then
  echo 'Usage: macos-install-smoke.sh <dmg> <x86_64|aarch64> <log-directory> [updater-app.tar.gz] [--allow-unsigned]' >&2
  exit 2
fi

dmg="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
arch="$2"
log_dir="$3"
updater_archive=''
allow_unsigned=0
if [[ "${4:-}" == '--allow-unsigned' ]]; then
  allow_unsigned=1
elif [[ -n "${4:-}" ]]; then
  updater_archive="$(cd "$(dirname "$4")" && pwd)/$(basename "$4")"
fi
if [[ -n "${5:-}" ]]; then
  [[ "$5" == '--allow-unsigned' ]] || { echo "Unknown option: $5" >&2; exit 2; }
  allow_unsigned=1
fi
if [[ "$allow_unsigned" == 0 && -z "$updater_archive" ]]; then
  echo 'Signed macOS smoke requires an updater-app.tar.gz archive' >&2
  exit 2
fi
mkdir -p "$log_dir"
log_dir="$(cd "$log_dir" && pwd)"
work_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/wae-macos-smoke.XXXXXX")"
mount_dir="$work_dir/mount"
install_dir="$work_dir/Applications"
app_pid=''
mounted=0

cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill -TERM "$app_pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$app_pid" 2>/dev/null || true
  fi
  if [[ "$mounted" == 1 ]]; then hdiutil detach "$mount_dir" -force >/dev/null 2>&1 || true; fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

[[ -f "$dmg" ]] || { echo "DMG does not exist: $dmg" >&2; exit 1; }
if [[ -n "$updater_archive" ]]; then
  [[ -f "$updater_archive" ]] || { echo "Updater archive does not exist: $updater_archive" >&2; exit 1; }
fi
[[ "$arch" == x86_64 || "$arch" == aarch64 ]] || { echo "Unsupported macOS architecture: $arch" >&2; exit 2; }
hdiutil verify "$dmg"
mkdir -p "$mount_dir" "$install_dir"
attach_log="$log_dir/macos-$arch-hdiutil-attach.log"
for attempt in 1 2 3; do
  if hdiutil attach "$dmg" -readonly -nobrowse -noautoopen -noverify -mountpoint "$mount_dir" >"$attach_log" 2>&1; then
    mounted=1
    break
  fi
  echo "hdiutil attach attempt $attempt failed" >&2
  cat "$attach_log" >&2
  hdiutil detach "$mount_dir" -force >/dev/null 2>&1 || true
  rm -rf "$mount_dir"
  mkdir -p "$mount_dir"
  sleep $((attempt * 2))
done
[[ "$mounted" == 1 ]] || { echo 'Unable to mount the DMG after 3 attempts' >&2; exit 1; }

app="$(find "$mount_dir" -maxdepth 2 -type d -name '*.app' -print -quit)"
[[ -n "$app" ]] || { echo 'Mounted DMG contains no .app bundle' >&2; exit 1; }
if [[ "$allow_unsigned" == 0 ]]; then
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign_details="$(codesign -d --verbose=4 "$app" 2>&1)"
  grep -F 'Authority=Developer ID Application:' <<<"$codesign_details" >/dev/null || {
    echo 'The app is not signed with a Developer ID Application identity' >&2
    echo "$codesign_details" >&2
    exit 1
  }
  spctl --assess --type execute --verbose=4 "$app"
  xcrun stapler validate "$app"
fi
node "$(dirname "$0")/inspect-installed-smoke.mjs" --root "$app"

bundle_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
[[ -n "$bundle_executable" && "$bundle_executable" == "$(basename "$bundle_executable")" ]] || {
  echo "Info.plist contains an invalid CFBundleExecutable: $bundle_executable" >&2
  exit 1
}
source_executable="$app/Contents/MacOS/$bundle_executable"
[[ -x "$source_executable" ]] || { echo "App bundle main executable is missing or not executable: $source_executable" >&2; exit 1; }
architectures="$(lipo -archs "$source_executable")"
[[ "$architectures" == "$arch" ]] || {
  echo "Mach-O architecture mismatch: expected only $arch, found $architectures" >&2
  exit 1
}
expected_minimum_os="$([[ "$arch" == x86_64 ]] && printf '10.15' || printf '11.0')"
build_version="$(xcrun vtool -show-build "$source_executable")"
minimum_os="$(awk '$1 == "minos" { print $2; exit }' <<<"$build_version")"
[[ "$minimum_os" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || {
  echo "Cannot determine the Mach-O minimum macOS version: $minimum_os" >&2
  echo "$build_version" >&2
  exit 1
}
IFS=. read -r actual_major actual_minor actual_patch <<<"$minimum_os"
IFS=. read -r expected_major expected_minor expected_patch <<<"$expected_minimum_os"
actual_patch="${actual_patch:-0}"
expected_patch="${expected_patch:-0}"
if ((
  10#$actual_major > 10#$expected_major ||
  (10#$actual_major == 10#$expected_major && 10#$actual_minor > 10#$expected_minor) ||
  (10#$actual_major == 10#$expected_major && 10#$actual_minor == 10#$expected_minor && 10#$actual_patch > 10#$expected_patch)
)); then
  echo "Mach-O deployment target $minimum_os exceeds the supported $expected_minimum_os baseline" >&2
  exit 1
fi

if [[ "$allow_unsigned" == 0 ]]; then
  updater_extract="$work_dir/updater"
  mkdir -p "$updater_extract"
  archive_listing="$(tar -tzf "$updater_archive")"
  [[ -n "$archive_listing" ]] || { echo 'Updater archive is empty' >&2; exit 1; }
  archive_details="$(tar -tvzf "$updater_archive")"
  [[ -n "$archive_details" ]] || { echo 'Cannot inspect updater archive entry types' >&2; exit 1; }
  while IFS= read -r entry_details; do
    entry_type="${entry_details:0:1}"
    if [[ "$entry_type" != '-' && "$entry_type" != 'd' ]]; then
      echo "Updater archive contains a link or special entry: $entry_details" >&2
      exit 1
    fi
  done <<<"$archive_details"
  while IFS= read -r entry; do
    normalized="${entry#./}"
    if [[ "$normalized" == /* || "$normalized" == '..' || "/$normalized/" == *'/../'* ]]; then
      echo "Updater archive contains an unsafe path: $entry" >&2
      exit 1
    fi
  done <<<"$archive_listing"
  tar --no-same-owner -xzf "$updater_archive" -C "$updater_extract"
  node "$(dirname "$0")/inspect-installed-smoke.mjs" --root "$updater_extract"
  updater_app_count="$(find "$updater_extract" -type d -name '*.app' -prune | wc -l | tr -d '[:space:]')"
  [[ "$updater_app_count" == 1 ]] || {
    echo "Updater archive must contain exactly one .app bundle, found $updater_app_count" >&2
    exit 1
  }
  updater_app="$(find "$updater_extract" -type d -name '*.app' -prune -print -quit)"
  codesign --verify --deep --strict --verbose=2 "$updater_app"
  spctl --assess --type execute --verbose=4 "$updater_app"
  xcrun stapler validate "$updater_app"
  updater_bundle_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$updater_app/Contents/Info.plist")"
  [[ -n "$updater_bundle_executable" && "$updater_bundle_executable" == "$(basename "$updater_bundle_executable")" ]] || {
    echo "Updater Info.plist contains an invalid CFBundleExecutable: $updater_bundle_executable" >&2
    exit 1
  }
  updater_executable="$updater_app/Contents/MacOS/$updater_bundle_executable"
  [[ -x "$updater_executable" ]] || { echo "Updater main executable is missing: $updater_executable" >&2; exit 1; }
  updater_architectures="$(lipo -archs "$updater_executable")"
  [[ "$updater_architectures" == "$arch" ]] || {
    echo "Updater Mach-O architecture mismatch: expected only $arch, found $updater_architectures" >&2
    exit 1
  }
  updater_build_version="$(xcrun vtool -show-build "$updater_executable")"
  updater_minimum_os="$(awk '$1 == "minos" { print $2; exit }' <<<"$updater_build_version")"
  [[ "$updater_minimum_os" == "$minimum_os" ]] || {
    echo "Updater deployment target $updater_minimum_os differs from DMG app target $minimum_os" >&2
    exit 1
  }
  cmp -s "$source_executable" "$updater_executable" || {
    echo 'Updater and DMG contain different main executables' >&2
    exit 1
  }
fi

installed_app="$install_dir/$(basename "$app")"
ditto "$app" "$installed_app"
installed_executable="$installed_app/Contents/MacOS/$bundle_executable"
if [[ "$allow_unsigned" == 0 ]]; then
  codesign --verify --deep --strict "$installed_app"
fi
association_report="$log_dir/macos-$arch-associations.json"
node "$(dirname "$0")/verify-bundle-associations.mjs" \
  --platform macos \
  --root "$installed_app" \
  --report "$association_report"
node "$(dirname "$0")/run-installed-core-smoke.mjs" \
  --platform macos \
  --executable "$installed_executable" \
  --report "$log_dir/macos-$arch-core-smoke.json"

launch_log="$log_dir/macos-$arch-launch.log"
"$installed_executable" >"$launch_log" 2>&1 &
app_pid=$!
sleep 12
if ! kill -0 "$app_pid" 2>/dev/null; then
  wait "$app_pid" || exit_code=$?
  echo "Installed application exited during the 12-second startup observation (exit ${exit_code:-unknown})" >&2
  cat "$launch_log" >&2
  exit 1
fi
kill -TERM "$app_pid"
wait "$app_pid" || true
app_pid=''

rm -rf "$installed_app"
[[ ! -e "$installed_app" ]] || { echo "App uninstall (bundle removal) failed: $installed_app" >&2; exit 1; }

updater_archive_report=null
if [[ -n "$updater_archive" ]]; then updater_archive_report="\"$(basename "$updater_archive")\""; fi
signature_verified=true
unsigned_preview=false
if [[ "$allow_unsigned" == 1 ]]; then
  signature_verified=false
  unsigned_preview=true
fi

cat >"$log_dir/macos-$arch-install-smoke.json" <<EOF
{
  "schemaVersion": 1,
  "platform": "macos",
  "arch": "$arch",
  "dmg": "$(basename "$dmg")",
  "updaterArchive": $updater_archive_report,
  "machOArchitectures": "$architectures",
  "minimumSystemVersion": "$minimum_os",
  "unsignedPreview": $unsigned_preview,
  "developerIdVerified": $signature_verified,
  "gatekeeperVerified": $signature_verified,
  "notarizationTicketVerified": $signature_verified,
  "updaterContentVerified": $signature_verified,
  "updaterMatchesDmg": $signature_verified,
  "associationMetadataVerified": true,
  "associationReport": "$(basename "$association_report")",
  "startupObservationSeconds": 12,
  "uninstallVerified": true
}
EOF

hdiutil detach "$mount_dir" >/dev/null
mounted=0
echo "macOS mount/install/start/remove smoke passed for $arch (allow_unsigned=$allow_unsigned)"
