#!/bin/bash
# Builds, signs, and notarizes Sidenote.app, then drops the download zip at
# public/Sidenote.zip. Usage: scripts/build-mac-app.sh [--skip-notarize]
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
IDENTITY="Developer ID Application: Brian Doran (CUH66KFZ33)"
NOTARY_PROFILE="dxyz-notary"
SKIP_NOTARIZE=0
[[ "${1:-}" == "--skip-notarize" ]] && SKIP_NOTARIZE=1

COMMIT="$(git rev-parse HEAD)"
COMMIT_DATE="$(git log -1 --format=%cs)"
VERSION="$(date +%Y.%-m.%-d)"
BUILD_NUM="$(git rev-list --count HEAD)"
NODE_BIN="$(command -v node)"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

step "Building the web app (standalone)…"
SIDENOTE_STANDALONE=1 npm run build

step "Building the native shell…"
(cd macos && swift build -c release --arch arm64)

step "Assembling Sidenote.app…"
BUILD="$ROOT/build/mac"
APP="$BUILD/Sidenote.app"
rm -rf "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources/server"

cp macos/.build/release/SidenoteShell "$APP/Contents/MacOS/Sidenote"
cp "$NODE_BIN" "$APP/Contents/Helpers/Sidenote Engine"
chmod +x "$APP/Contents/Helpers/Sidenote Engine"

SERVER="$APP/Contents/Resources/server"
cp -R .next/standalone/. "$SERVER/"
# File tracing over-includes project files (routes touch process.cwd()); the
# server only needs server.js, .next, node_modules, package.json, and public.
rm -rf "$SERVER/build" "$SERVER/verify" "$SERVER/src" "$SERVER/scripts" \
       "$SERVER/macos" "$SERVER/public" "$SERVER/Sidenote Engine" \
       "$SERVER/sidenote.log" "$SERVER/package-lock.json" \
       "$SERVER/tsconfig.tsbuildinfo" "$SERVER/.git"
# Never ship a developer's API key to everyone who downloads the app. Nothing
# copies .env today, but this is a one-line guard against a catastrophic
# mistake and a hard failure if one ever slips through.
rm -f "$SERVER"/.env "$SERVER"/.env.*
if grep -rlq "sk-ant-api" "$SERVER" 2>/dev/null; then
  echo "ABORT: an Anthropic API key is inside the app bundle" >&2
  exit 1
fi
mkdir -p "$SERVER/.next"
rm -rf "$SERVER/.next/static"
cp -R .next/static "$SERVER/.next/static"
cp -R public "$SERVER/public"
rm -f "$SERVER/public/Sidenote.zip"   # never nest the download inside itself

sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NUM/" \
    -e "s/__COMMIT__/$COMMIT/" -e "s/__COMMIT_DATE__/$COMMIT_DATE/" \
    macos/Info.plist > "$APP/Contents/Info.plist"

step "Building the icon…"
ICONSET="$BUILD/Sidenote.iconset"
mkdir -p "$ICONSET"
SRC_ICON="public/icon-512.png"
for size in 16 32 128 256 512; do
  sips -z $size $size "$SRC_ICON" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  if [[ $double -le 512 ]]; then
    sips -z $double $double "$SRC_ICON" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  fi
done
cp "$SRC_ICON" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Sidenote.icns"

step "Signing (inside-out, hardened runtime)…"
# Native node modules and dylibs first, then the engine (with JIT
# entitlements), then the bundle.
find "$SERVER" -type f \( -name "*.node" -o -name "*.dylib" \) -print0 | while IFS= read -r -d '' f; do
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$f"
done
codesign --force --options runtime --timestamp \
  --entitlements macos/engine.entitlements \
  --sign "$IDENTITY" "$APP/Contents/Helpers/Sidenote Engine"
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --strict --deep "$APP"
echo "signature OK"

step "Zipping…"
ZIP="$BUILD/Sidenote.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
du -h "$ZIP"

if [[ "$SKIP_NOTARIZE" == 0 ]]; then
  step "Notarizing (this takes a few minutes)…"
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  step "Stapling…"
  xcrun stapler staple "$APP"
  rm -f "$ZIP"
  ditto -c -k --keepParent "$APP" "$ZIP"
  spctl -a -vv "$APP"
fi

# The binary deliberately does NOT go into public/. It used to, and because
# public/Sidenote.zip is gitignored a CLI deploy carried it while a
# git-triggered deploy served a 404 in its place. Publishing is now a separate
# step against GitHub Releases; build.json is written there too, so the version
# the site advertises can never drift from the file it actually serves.
step "Done → $ZIP ($(du -h "$ZIP" | cut -f1))"
echo "   next: scripts/build-dmg.sh && scripts/release.sh"
