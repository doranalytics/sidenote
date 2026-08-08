#!/bin/bash
# Wraps an already-built Sidenote.app in a signed, notarized disk image.
# Usage: scripts/build-dmg.sh [--skip-notarize]
#
# A .dmg rather than a .zip because of what a zip does to a first install:
# double-clicking the app straight out of Downloads runs it from a read-only
# translocated mirror, which is how people ended up with "Sidenote 2.app",
# permissions that never stick, and — worst — a new download that silently
# focused the OLD copy still running from /Applications. A disk image puts the
# app and an Applications alias side by side and asks for one drag, which is
# both the convention people recognise and the only path that avoids all of it.
#
# Deliberately no AppleScript: every prettier DMG recipe drives Finder to
# place icons, and that throws an "wants access to control Finder" prompt on
# the build machine. Layout comes from the window geometry written below.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
IDENTITY="Developer ID Application: Brian Doran (CUH66KFZ33)"
NOTARY_PROFILE="dxyz-notary"
SKIP_NOTARIZE=0
[[ "${1:-}" == "--skip-notarize" ]] && SKIP_NOTARIZE=1

BUILD="$ROOT/build/mac"
APP="$BUILD/Sidenote.app"
DMG="$BUILD/Sidenote.dmg"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

[[ -d "$APP" ]] || { echo "No app at $APP — run scripts/build-mac-app.sh first" >&2; exit 1; }

# The app must already be signed; notarizing the image does not notarize what
# is inside it.
codesign --verify --strict "$APP" || { echo "ABORT: $APP is not properly signed" >&2; exit 1; }

step "Staging the disk image…"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/Sidenote.app"
ln -s /Applications "$STAGE/Applications"

step "Creating the image…"
rm -f "$DMG"
hdiutil create \
  -volname "Sidenote" \
  -srcfolder "$STAGE" \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov -quiet \
  "$DMG"

step "Signing the image…"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
codesign --verify --strict "$DMG"

if [[ "$SKIP_NOTARIZE" == 0 ]]; then
  step "Notarizing the image (a few minutes)…"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  step "Stapling…"
  # Stapled to the image itself, so the very first open is not gated on the
  # user being online.
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  spctl -a -t open --context context:primary-signature -vv "$DMG"
fi

step "Done → $DMG ($(du -h "$DMG" | cut -f1))"
