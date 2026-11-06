#!/usr/bin/env bash
# Android APK alignment & signing tool.
#
# Prefers environment variables (non-interactive, CI-safe):
#   ANDROID_KEYSTORE_PATH   path to the .jks/.keks keystore
#   ANDROID_KEYSTORE_ALIAS  key alias
#   ANDROID_KEYSTORE_PASSWORD  key / keystore password
#   ANDROID_HOME            Android SDK root (defaults to $HOME/Android/Sdk)
# Falls back to interactive prompts only when run in a terminal and the vars are unset.
set -euo pipefail

echo "=================================================="
echo "          Android APK Alignment & Signing Tool"
echo "=================================================="

# ── Locate the release (unsigned-named) APK ──────────────────────────────
APK="release-builds/android/isms-release.apk"
if [ ! -f "$APK" ]; then
    if [ -f "android/app/build/outputs/apk/release/app-release-unsigned.apk" ]; then
        mkdir -p release-builds/android
        cp "android/app/build/outputs/apk/release/app-release-unsigned.apk" "$APK"
    else
        echo "Error: Release APK not found at $APK"
        echo "Run build-local.sh or ./release.sh first."
        exit 1
    fi
fi

ALIGNED_APK="release-builds/android/isms-release-aligned.apk"
SIGNED_APK="release-builds/android/isms-release-signed.apk"

# ── Locate Android build-tools (apksigner / zipalign) ────────────────────
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [ ! -d "$ANDROID_HOME/build-tools" ]; then
    echo "Error: Android SDK build-tools not found at $ANDROID_HOME/build-tools"
    exit 1
fi
BUILD_TOOLS="$(ls -1 "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)"
APKSIGNER="$ANDROID_HOME/build-tools/$BUILD_TOOLS/apksigner"
ZIPALIGN="$ANDROID_HOME/build-tools/$BUILD_TOOLS/zipalign"
if [ ! -x "$APKSIGNER" ] || [ ! -x "$ZIPALIGN" ]; then
    echo "Error: apksigner/zipalign not found in $ANDROID_HOME/build-tools/$BUILD_TOOLS"
    exit 1
fi

# ── Keystore ─────────────────────────────────────────────────────────────
KEYSTORE="${ANDROID_KEYSTORE_PATH:-my-release.keystore}"
if [ ! -f "$KEYSTORE" ]; then
    echo "Error: Keystore file not found at $KEYSTORE"
    echo "Set ANDROID_KEYSTORE_PATH or place my-release.keystore in the project root."
    exit 1
fi

# ── Key alias / password (env first, interactive fallback) ───────────────
KEY_ALIAS="${ANDROID_KEYSTORE_ALIAS:-}"
KEY_PASS="${ANDROID_KEYSTORE_PASSWORD:-}"

if [ -t 0 ] && { [ -z "$KEY_ALIAS" ] || [ -z "$KEY_PASS" ]; }; then
    read -p "Enter Keystore Alias [default: kaykays-release]: " KEY_ALIAS
    KEY_ALIAS="${KEY_ALIAS:-kaykays-release}"
    read -s -p "Enter Keystore Password: " KEY_PASS
    echo ""
fi
KEY_ALIAS="${KEY_ALIAS:-kaykays-release}"

if [ -z "$KEY_PASS" ]; then
    echo "Error: Keystore password not provided (set ANDROID_KEYSTORE_PASSWORD)."
    exit 1
fi

echo "--> Using keystore: $KEYSTORE (alias: $KEY_ALIAS, build-tools: $BUILD_TOOLS)"

# ── Align ────────────────────────────────────────────────────────────────
echo "--> Aligning APK..."
rm -f "$ALIGNED_APK"
"$ZIPALIGN" -v 4 "$APK" "$ALIGNED_APK" > /dev/null

# ── Sign ─────────────────────────────────────────────────────────────────
echo "--> Signing APK..."
rm -f "$SIGNED_APK"
"$APKSIGNER" sign --ks "$KEYSTORE" \
    --ks-key-alias "$KEY_ALIAS" \
    --ks-pass pass:"$KEY_PASS" \
    --key-pass pass:"$KEY_PASS" \
    --out "$SIGNED_APK" \
    "$ALIGNED_APK"

# ── Verify ───────────────────────────────────────────────────────────────
echo "--> Verifying signature..."
"$APKSIGNER" verify --verbose "$SIGNED_APK"

echo "=================================================="
echo "SUCCESS: Signed APK created successfully!"
echo "Location: $SIGNED_APK"
echo "=================================================="
echo "Note: To install this on your phone without using ADB:"
echo "1. Uninstall any old version of the app from your phone first (long-press icon -> Uninstall)."
echo "2. Share/send '$SIGNED_APK' to your phone (via WhatsApp, Google Drive, email, etc.)."
echo "3. Tap the APK file on your phone's File Manager to install it directly."
echo "=================================================="
