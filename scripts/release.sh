#!/bin/bash
# Publishes the built app to the private release store and points the site at it.
# Usage: scripts/release.sh [--github]
#
# Builds live in the `releases` bucket of the Sidenote Supabase project, which
# is private: sidenote.lol hands out 60-second links to people who have paid
# (/api/download for the DMG, /api/release/Sidenote.zip for the in-app
# updater). They used to be public GitHub Releases — which is no paywall at
# all — and before that a 72 MB file inside the Vercel deployment, which a
# git-triggered deploy would silently drop.
#
# --github additionally publishes to GitHub Releases. That exists for one
# reason: copies of Sidenote built before the paywall update themselves from
# there, so the first paywall build has to go up publicly or they can never
# reach the code that knows about the private store. After that, don't.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
REPO="doranalytics/sidenote"
BUILD="$ROOT/build/mac"
APP="$BUILD/Sidenote.app"
DMG="$BUILD/Sidenote.dmg"
ZIP="$BUILD/Sidenote.zip"
GITHUB=0
[[ "${1:-}" == "--github" ]] && GITHUB=1

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

step "Uploading ${TAG} to the private release store…"
# `supabase link` once (project ref dvmpjltqemrrrbrbmnhf) and this just works.
# cp refuses to overwrite, so the previous build is removed first.
for f in Sidenote.dmg Sidenote.zip; do
  yes | supabase storage rm "ss:///releases/$f" --experimental >/dev/null 2>&1 || true
done
supabase storage cp "$DMG" ss:///releases/Sidenote.dmg --experimental
supabase storage cp "$ZIP" ss:///releases/Sidenote.zip --experimental

if [[ $GITHUB == 1 ]]; then
  step "Also publishing ${TAG} to GitHub Releases (public — transition build only)…"
  if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    gh release upload "$TAG" "$DMG" "$ZIP" --repo "$REPO" --clobber
  else
    gh release create "$TAG" "$DMG" "$ZIP" \
      --repo "$REPO" \
      --title "Sidenote $VERSION" \
      --notes "Build $BUILD_NUM — $COMMIT_DATE

Sidenote is \$39 at https://sidenote.lol. This release exists so earlier installs can update themselves; AI and future updates need a purchase."
  fi
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

step "Released ${TAG}"
echo "   dmg → releases/Sidenote.dmg (private; served by sidenote.lol/api/download)"
echo "   zip → releases/Sidenote.zip (private; served by sidenote.lol/api/release/Sidenote.zip)"
[[ $GITHUB == 1 ]] && echo "   github → https://github.com/$REPO/releases/tag/$TAG"
echo "   build.json → $COMMIT ($COMMIT_DATE) — commit and deploy the site next"
