#!/bin/bash
# Exit on any error
set -e

APP_NAME="KayKays"
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
if [ -f "my-release.keystore" ]; then
    echo "=================================================="
    echo "--> Keystore found. Preparing to sign APK automatically..."
    
    # Load .env for passwords if it exists
    if [ -f ".env" ]; then
        source .env
    fi

    KEY_ALIAS=${ANDROID_KEY_ALIAS:-my-key-alias}
    KEY_PASS=${ANDROID_KEY_PASS:-}
    
    # Locate Android SDK tools
    SDK_PATH="$HOME/Android/Sdk/build-tools"
    if [ -d "$SDK_PATH" ]; then
        SDK_VERSION=$(ls "$SDK_PATH" | sort -rn | head -1)
        APKSIGNER="$SDK_PATH/${SDK_VERSION}/apksigner"
        ZIPALIGN="$SDK_PATH/${SDK_VERSION}/zipalign"
    else
        echo "Error: Could not find Android SDK at $SDK_PATH"
        exit 1
    fi

    if [ -n "$KEY_PASS" ]; then
        echo "--> Aligning APK..."
        "$ZIPALIGN" -v 4 "$UNSIGNED_APK" "$RELEASE_DIR/${APP_NAME}-aligned.apk" > /dev/null

        echo "--> Signing APK with alias '$KEY_ALIAS'..."
        "$APKSIGNER" sign --ks "my-release.keystore" \
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
        echo "--> Warning: No ANDROID_KEY_PASS found in .env file. Copying unsigned APK instead."
        echo "--> (Add ANDROID_KEY_PASS='yourpassword' to .env to enable auto-signing)."
        cp "$UNSIGNED_APK" "$RELEASE_DIR/${APP_NAME}-unsigned.apk"
    fi
else
    echo "--> No my-release.keystore found. Copying unsigned APK..."
    cp "$UNSIGNED_APK" "$RELEASE_DIR/${APP_NAME}-unsigned.apk"
fi

echo "=================================================="
echo "          ALL DONE! Output ready in ./$RELEASE_DIR"
echo "=================================================="
ls -lh "$RELEASE_DIR"
