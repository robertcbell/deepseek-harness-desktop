#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/build"
APP_NAME="DeepSeek Harness"
BUNDLE_DIR="$BUILD_DIR/$APP_NAME.app"

echo "==> Building $APP_NAME for macOS (arm64)..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# Compile Swift sources using swiftc
echo "==> Compiling Swift sources with swiftc..."
swiftc -O \
  -target arm64-apple-macos12.0 \
  -sdk "$(xcrun --show-sdk-path)" \
  -parse-as-library \
  "$SCRIPT_DIR/src/AppDelegate.swift" \
  "$SCRIPT_DIR/src/main.swift" \
  -o "$BUNDLE_DIR/Contents/MacOS/DeepSeekHarness"

# Copy resources
echo "==> Copying resources & Info.plist..."
cp "$SCRIPT_DIR/resources/Info.plist" "$BUNDLE_DIR/Contents/Info.plist"
if [ -f "$SCRIPT_DIR/resources/AppIcon.icns" ]; then
  cp "$SCRIPT_DIR/resources/AppIcon.icns" "$BUNDLE_DIR/Contents/Resources/AppIcon.icns"
fi
if [ -f "$SCRIPT_DIR/resources/injected_bundle.js" ]; then
  cp "$SCRIPT_DIR/resources/injected_bundle.js" "$BUNDLE_DIR/Contents/Resources/injected_bundle.js"
fi

# Ad-hoc code sign
echo "==> Applying ad-hoc codesign..."
codesign -s - --force --deep "$BUNDLE_DIR"

echo "==> Successfully built $APP_NAME at: $BUNDLE_DIR"
