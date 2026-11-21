#!/bin/bash
set -euo pipefail

bundle=src-tauri/target/aarch64-apple-darwin/release/bundle
output=preview-artifacts
apps=("$bundle"/macos/*.app)
images=("$bundle"/dmg/*.dmg)
test "${#apps[@]}" = 1
test "${#images[@]}" = 1
app="${apps[0]}"
image="${images[0]}"
plist="$app/Contents/Info.plist"
plutil -lint "$plist"
plutil -p "$plist"
get_key() { plutil -extract "$1" raw -o - "$plist"; }

executable="$(get_key CFBundleExecutable)"
binary="$app/Contents/MacOS/$executable"
icon="$(get_key CFBundleIconFile)"
test -s "$app/Contents/Resources/$icon" || test -s "$app/Contents/Resources/$icon.icns"
test "$(get_key CFBundleIdentifier)" = org.shandong-study.knowpaper-preview
test "$(get_key CFBundleShortVersionString)" = "$(node -p 'require("./package.json").version')"
test "$(get_key LSMinimumSystemVersion)" = 13.0
test "$executable" = knowpaper-preview
test "$(lipo -archs "$binary")" = arm64
file "$binary"
otool -L "$binary"
find "$app/Contents" -type f -print
codesign --verify --deep --strict --verbose=2 "$app"
codesign --display --verbose=4 "$app"
spctl --assess --type execute --verbose=4 "$app" || echo "Gatekeeper assessment exit: $?"
hdiutil imageinfo "$image"
hdiutil verify "$image"

mount="$(mktemp -d)"
trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true; rmdir "$mount"' EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$image"
ls -la "$mount"
diff -qr "$app" "$mount/$(basename "$app")"
test "$(readlink "$mount/Applications")" = /Applications
hdiutil detach "$mount"
rmdir "$mount"
trap - EXIT

cp "$plist" "$output/Info.plist"
cp "$image" "$output/"
ditto -c -k --keepParent "$app" "$output/KnowPaper-Preview-arm64.app.zip"
(
  cd "$output"
  shasum -a 256 *.dmg *.app.zip > SHA256SUMS
  cat SHA256SUMS
)
BUNDLE_NAME="$(get_key CFBundleName)" BINARY_NAME="$executable" \
  BUNDLE_VERSION="$(get_key CFBundleShortVersionString)" DMG_NAME="$(basename "$image")" \
  DMG_BYTES="$(stat -f %z "$image")" node --input-type=module <<'JS' > "$output/manifest.json"
import { readFileSync } from 'node:fs';
const env = process.env;
console.log(JSON.stringify({
  commit: env.GITHUB_SHA,
  run: env.GITHUB_RUN_ID,
  runner: 'macos-15',
  architecture: process.arch,
  identifier: 'org.shandong-study.knowpaper-preview',
  name: env.BUNDLE_NAME,
  executable: env.BINARY_NAME,
  version: env.BUNDLE_VERSION,
  minimumSystemVersion: '13.0',
  signing: 'ad-hoc',
  notarized: false,
  dmg: env.DMG_NAME,
  dmgBytes: Number(env.DMG_BYTES),
  sha256: readFileSync('preview-artifacts/SHA256SUMS', 'utf8').split(/\s+/)[0],
}, null, 2));
JS
