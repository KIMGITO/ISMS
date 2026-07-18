#!/usr/bin/env bash
# Exit on any error
set -e

# Configuration
SDK_VERSION="35.0.0"
APKSIGNER="/home/dennis/Android/Sdk/build-tools/${SDK_VERSION}/apksigner"
ZIPALIGN="/home/dennis/Android/Sdk/build-tools/${SDK_VERSION}/zipalign"

UNSIGNED_APK="release-builds/android/kaykay-release-unsigned.apk"
ALIGNED_APK="release-builds/android/kaykay-release-aligned.apk"
SIGNED_APK="release-builds/android/kaykay-release-signed.apk"
KEYSTORE="my-release.keystore"

echo "=================================================="
echo "          Android APK Alignment & Signing Tool"
echo "=================================================="

# Check if unsigned APK exists
if [ ! -f "$UNSIGNED_APK" ]; then
    # Fallback to copy from build output if build-local was run
    if [ -f "android/app/build/outputs/apk/release/app-release-unsigned.apk" ]; then
        mkdir -p release-builds/android
        cp android/app/build/outputs/apk/release/app-release-unsigned.apk "$UNSIGNED_APK"
    else
        echo "Error: Unsigned APK not found at $UNSIGNED_APK"
        echo "Please run build-local.sh first."
        exit 1
    fi
fi

# Check if keystore exists
if [ ! -f "$KEYSTORE" ]; then
    echo "Error: Keystore file not found at $KEYSTORE"
    exit 1
fi

# Ask for keystore details
read -p "Enter Keystore Alias [default: my-key-alias]: " KEY_ALIAS
KEY_ALIAS=${KEY_ALIAS:-my-key-alias}

# Read password securely
read -s -p "Enter Keystore Password: " KEY_PASS
echo ""

if [ -z "$KEY_PASS" ]; then
    echo "Error: Password cannot be empty."
    exit 1
fi

echo "--> Aligning APK..."
rm -f "$ALIGNED_APK"
"$ZIPALIGN" -v 4 "$UNSIGNED_APK" "$ALIGNED_APK" > /dev/null

echo "--> Signing APK with $KEYSTORE..."
rm -f "$SIGNED_APK"
"$APKSIGNER" sign --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass pass:"$KEY_PASS" \
  --key-pass pass:"$KEY_PASS" \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK"

echo "--> Verifying Signature..."
"$APKSIGNER" verify "$SIGNED_APK"

echo "=================================================="
echo "SUCCESS: Signed APK created successfully!"
echo "Location: $SIGNED_APK"
echo "=================================================="
echo "Note: To install this on your phone without using ADB:"
echo "1. Uninstall any old version of the app from your phone first (long-press icon -> Uninstall)."
echo "2. Share/send '$SIGNED_APK' to your phone (via WhatsApp, Google Drive, email, etc.)."
echo "3. Tap the APK file on your phone's File Manager to install it directly."
echo "=================================================="
