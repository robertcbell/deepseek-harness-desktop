#!/usr/bin/env bash
# Package DeepSeek Harness into a distributable macOS .dmg disk image
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/build"
APP_NAME="DeepSeek Harness"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
DMG_NAME="DeepSeek-Harness-macOS.dmg"
DMG_OUTPUT="$BUILD_DIR/$DMG_NAME"
STAGING_DIR="$BUILD_DIR/dmg_staging"

# 1. Ensure .app is built
if [ ! -d "$APP_BUNDLE" ]; then
  echo "==> Application bundle not found. Building now..."
  bash "$ROOT_DIR/app/build.sh"
fi

echo "==> Preparing DMG staging directory..."
rm -rf "$STAGING_DIR"
rm -f "$DMG_OUTPUT"
mkdir -p "$STAGING_DIR"

# 2. Copy App to staging
echo "==> Copying $APP_NAME.app..."
cp -R "$APP_BUNDLE" "$STAGING_DIR/$APP_NAME.app"

# 3. Create Applications symlink for drag-and-drop installation
echo "==> Creating /Applications symlink..."
ln -s /Applications "$STAGING_DIR/Applications"

# 4. Create DMG with hdiutil
echo "==> Creating compressed DMG image..."
hdiutil create \
  -volname "DeepSeek Harness" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_OUTPUT"

# 5. Clean up staging
rm -rf "$STAGING_DIR"

echo "==> Successfully created DMG installer at:"
echo "    $DMG_OUTPUT"
echo "    Size: $(du -h "$DMG_OUTPUT" | cut -f1)"
