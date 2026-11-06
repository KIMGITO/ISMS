#!/bin/bash
# Exit on any error
set -e

APP_NAME="KayKay's"
RELEASE_DIR="release"

echo "=================================================="
echo "          $APP_NAME Unified Release Builder       "
echo "=================================================="

# 1. Clean release directory
echo "--> Cleaning up old releases..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# 2. Build Web Frontend
echo "--> Building Web Frontend (Vite)..."
npx vite build

# 3. Build Linux Apps
echo "--> Building Linux Apps (Tauri)..."
npm run tauri build

echo "--> Copying Linux bundles..."
cp src-tauri/target/release/bundle/appimage/*.AppImage "$RELEASE_DIR/${APP_NAME}.AppImage" || true
cp src-tauri/target/release/bundle/deb/*.deb "$RELEASE_DIR/${APP_NAME}.deb" || true

# 4. Build Android App
echo "--> Syncing web assets to Android (Capacitor)..."
npx cap sync android

echo "--> Building Android Release APK..."
cd android
./gradlew assembleRelease
cd ..

UNSIGNED_APK="android/app/build/outputs/apk/release/app-release-unsigned.apk"

# 5. Sign Android App
# Signing credentials are read from .env (and
# $HOME/.config/kaykays-signing/credentials.env as an override). These names
# match build.gradle, sign-apk.sh and CI.
SIGNING_ENV="$HOME/.config/kaykays-signing/credentials.env"
[ -f .env ] && source .env
[ -f "$SIGNING_ENV" ] && source "$SIGNING_ENV"

if [ -n "${ANDROID_KEYSTORE_PATH:-}" ] && [ -f "$ANDROID_KEYSTORE_PATH" ]; then
    echo "=================================================="
    echo "--> Keystore found at $ANDROID_KEYSTORE_PATH. Preparing to sign APK automatically..."
    
    KEY_ALIAS="${ANDROID_KEYSTORE_ALIAS:-}"
    KEY_PASS="${ANDROID_KEYSTORE_PASSWORD:-}"
    
    # Locate Android SDK tools
    SDK_PATH="${ANDROID_HOME:-$HOME/Android/Sdk}/build-tools"
    if [ -d "$SDK_PATH" ]; then
        SDK_VERSION=$(ls -1 "$SDK_PATH" | sort -V | tail -n 1)
        APKSIGNER="$SDK_PATH/$SDK_VERSION/apksigner"
        ZIPALIGN="$SDK_PATH/$SDK_VERSION/zipalign"
    else
        echo "Error: Could not find Android SDK at $SDK_PATH"
        exit 1
    fi

    if [ -n "$KEY_PASS" ] && [ -n "$KEY_ALIAS" ]; then
        echo "--> Aligning APK..."
        "$ZIPALIGN" -v 4 "$UNSIGNED_APK" "$RELEASE_DIR/${APP_NAME}-aligned.apk" > /dev/null

        echo "--> Signing APK with alias '$KEY_ALIAS'..."
        "$APKSIGNER" sign --ks "$ANDROID_KEYSTORE_PATH" \
          --ks-key-alias "$KEY_ALIAS" \
          --ks-pass pass:"$KEY_PASS" \
          --key-pass pass:"$KEY_PASS" \
          --out "$RELEASE_DIR/${APP_NAME}.apk" \
          "$RELEASE_DIR/${APP_NAME}-aligned.apk"
        
        echo "--> Verifying Signature..."
        "$APKSIGNER" verify "$RELEASE_DIR/${APP_NAME}.apk"
        
        # Cleanup temp aligned
        rm -f "$RELEASE_DIR/${APP_NAME}-aligned.apk"
    else
        echo "--> Warning: ANDROID_KEYSTORE_ALIAS/PASSWORD not set. Copying unsigned APK instead."
        echo "--> (Add them to .env to enable auto-signing)."
        cp "$UNSIGNED_APK" "$RELEASE_DIR/${APP_NAME}-unsigned.apk"
    fi
else
    echo "--> No signing key found (set ANDROID_KEYSTORE_PATH/ALIAS/PASSWORD in .env). Copying unsigned APK..."
    cp "$UNSIGNED_APK" "$RELEASE_DIR/${APP_NAME}-unsigned.apk"
fi

echo "=================================================="
echo "          ALL DONE! Output ready in ./$RELEASE_DIR"
echo "=================================================="
ls -lh "$RELEASE_DIR"
