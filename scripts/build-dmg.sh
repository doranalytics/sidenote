#!/bin/bash
# Wraps an already-built Sidenote.app in a signed, notarized disk image.
# Usage: scripts/build-dmg.sh [--skip-notarize]
#
# A .dmg rather than a .zip because of what a zip does to a first install:
# double-clicking the app straight out of Downloads runs it from a read-only
# translocated mirror, which is how people ended up with "Sidenote 2.app",
# permissions that never stuck, and — worst — a new download that silently
# focused the OLD copy still running from /Applications.
#
# The window is laid out on purpose. An unstyled image is two unlabelled icons
# in a bare window, where the one thing you are meant to do (drag left onto
# right) is the one thing nothing says, and double-clicking the app instead
# runs it off the image — straight back into the trap the DMG exists to avoid.
#
# Layout comes from dmgbuild, which writes the .DS_Store itself. Every other
# recipe drives Finder over AppleScript and throws an automation prompt on the
# build machine.
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
ASSETS="$BUILD/dmg-assets"
# Deliberately OUTSIDE the project. A venv contains symlinks that point out of
# the filesystem root, and Turbopack walks everything under the project when it
# traces modules — with this inside build/, `next build` dies with "Symlink ...
# is invalid", and the app build fails while the DMG happily wraps whatever
# stale bundle was left over.
VENV="${XDG_CACHE_HOME:-$HOME/.cache}/sidenote/dmgtools"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

[[ -d "$APP" ]] || { echo "No app at $APP — run scripts/build-mac-app.sh first" >&2; exit 1; }

# The app must already be signed; notarizing the image does not notarize what
# is inside it.
codesign --verify --strict "$APP" || { echo "ABORT: $APP is not properly signed" >&2; exit 1; }

step "Preparing dmgbuild…"
if [[ ! -x "$VENV/bin/dmgbuild" ]]; then
  mkdir -p "$(dirname "$VENV")"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q dmgbuild
fi

step "Rendering the background…"
mkdir -p "$ASSETS"
# Two resolutions stitched into one TIFF, so the window is crisp on a Retina
# display instead of a blurry upscale.
node -e "
const sharp = require('sharp');
const fs = require('fs');
const svg = fs.readFileSync('macos/dmg/background.svg');
(async () => {
  await sharp(svg, { density: 72 }).png().toFile('$ASSETS/bg.png');
  await sharp(svg, { density: 144 }).resize(1280, 800).png().toFile('$ASSETS/bg@2x.png');
})();
"
tiffutil -cathidpicheck "$ASSETS/bg.png" "$ASSETS/bg@2x.png" -out "$ASSETS/background.tiff" >/dev/null

step "Building the image…"
rm -f "$DMG"
"$VENV/bin/dmgbuild" \
  -s macos/dmg/settings.py \
  -D app="$APP" \
  -D background="$ASSETS/background.tiff" \
  "Sidenote" "$DMG"

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
