#!/bin/bash
# Exit on any error
set -e

echo "=================================================="
echo "         KayKay's Multi-Platform Local Builder   "
echo "=================================================="

# Create target directories
mkdir -p release-builds/linux
mkdir -p release-builds/android
mkdir -p release-builds/windows

echo "--> Cleaning up old builds..."
rm -rf release-builds/linux/*
rm -rf release-builds/android/*
rm -rf release-builds/windows/*

# ── 1. Build Vite frontend ──────────────────────
echo "--> Building Vite frontend..."
npm run build

# ── 2. Build Linux App (AppImage / Debian) ────────
echo "--> Building Linux Desktop Application..."
npm run tauri:build

echo "--> Copying Linux bundles..."
cp src-tauri/target/release/bundle/appimage/*.AppImage release-builds/linux/ || true
cp src-tauri/target/release/bundle/deb/*.deb release-builds/linux/ || true

# ── 3. Build Android App (Release APK) ──────────
echo "--> Syncing Capacitor Android..."
npx cap sync android

echo "--> Building Android Release APK..."
cd android
./gradlew assembleRelease
cd ..

echo "--> Copying Android release APK..."
cp android/app/build/outputs/apk/release/app-release-unsigned.apk release-builds/android/kaykay-release-unsigned.apk || true
# Also copy debug apk for convenience
cd android && ./gradlew assembleDebug && cd ..
cp android/app/build/outputs/apk/debug/app-debug.apk release-builds/android/kaykay-debug.apk || true

# ── 4. Build Windows App (via Docker) ───────────
echo "--> Building Windows App (.exe) via Docker (no host sudo/toolchain needed)..."
docker run --rm \
  -v "$(pwd)":/app \
  -v "$HOME/.cargo/registry:/root/.cargo/registry" \
  -v "$HOME/.cargo/git:/root/.cargo/git" \
  -w /app \
  node:20 bash -c "
    apt-get update && apt-get install -y mingw-w64 nsis
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --target x86_64-pc-windows-gnu
    source \$HOME/.cargo/env
    export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
    npm run tauri:build -- --target x86_64-pc-windows-gnu
  "

echo "--> Copying Windows NSIS installer..."
cp src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.exe release-builds/windows/ || true

# Fix permissions for built files (since Docker runs as root)
echo "--> Fixing output file permissions..."
sudo -n chown -R $(id -u):$(id -g) release-builds src-tauri/target/x86_64-pc-windows-gnu || true

echo "=================================================="
echo "         Build completed successfully!            "
echo "=================================================="
echo "Your release files are ready in the 'release-builds/' folder:"
ls -lh release-builds/linux/ release-builds/android/ release-builds/windows/
