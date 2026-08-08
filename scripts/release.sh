#!/bin/bash
# Publishes the built app to GitHub Releases and points the site at it.
# Usage: scripts/release.sh
#
# The download used to be a 72 MB file inside the Vercel deployment, which had
# a failure mode nobody would guess: public/Sidenote.zip is gitignored, so a
# CLI deploy carried it and a git-triggered deploy did not. Any push could
# therefore replace a working download page with a 404, and did. Releases are
# the fix — the binary lives somewhere a deploy cannot touch, and
# /releases/latest/download/<name> is a stable URL that always resolves to the
# newest one.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
REPO="doranalytics/sidenote"
BUILD="$ROOT/build/mac"
APP="$BUILD/Sidenote.app"
DMG="$BUILD/Sidenote.dmg"
ZIP="$BUILD/Sidenote.zip"

step() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }

for f in "$APP" "$DMG" "$ZIP"; do
  [[ -e "$f" ]] || { echo "Missing $f — run build-mac-app.sh then build-dmg.sh" >&2; exit 1; }
done

# Never publish something Gatekeeper would refuse.
step "Verifying signatures…"
spctl -a -vv "$APP"
xcrun stapler validate "$DMG"

COMMIT="$(git rev-parse HEAD)"
COMMIT_DATE="$(git log -1 --format=%cs)"
VERSION="$(date +%Y.%-m.%-d)"
BUILD_NUM="$(git rev-list --count HEAD)"
TAG="v$VERSION-$BUILD_NUM"

step "Publishing ${TAG} to ${REPO}…"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$DMG" "$ZIP" --repo "$REPO" --clobber
else
  gh release create "$TAG" "$DMG" "$ZIP" \
    --repo "$REPO" \
    --title "Sidenote $VERSION" \
    --notes "Build $BUILD_NUM — $COMMIT_DATE

Download **Sidenote.dmg**, open it, and drag Sidenote to Applications.

The .zip is what the in-app updater downloads; you do not need it."
fi

# The installed app compares itself against this, so it has to describe the
# release that just went up — not repo HEAD, which moves on every commit.
cat > public/build.json <<JSON
{
  "commit": "$COMMIT",
  "date": "$COMMIT_DATE",
  "version": "$VERSION",
  "build": $BUILD_NUM
}
JSON

step "Released → https://github.com/$REPO/releases/tag/$TAG"
echo "   dmg → https://github.com/$REPO/releases/latest/download/Sidenote.dmg"
echo "   zip → https://github.com/$REPO/releases/latest/download/Sidenote.zip"
echo "   build.json → $COMMIT ($COMMIT_DATE) — commit and deploy the site next"
