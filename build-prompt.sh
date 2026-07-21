#!/bin/bash
set -e

echo "Starting Vite Web Build..."
npx vite build

echo ""
echo "=========================================================="
echo "Web Build Finished."
echo "=========================================================="

read -p "Do you want to build the release apps too (Android/Linux)? [y/N] " -n 1 -r </dev/tty
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "--> Running build-local.sh..."
    if [ -x "./build-local.sh" ]; then
        ./build-local.sh
    else
        echo "Error: ./build-local.sh not executable. Fixing permissions..."
        chmod +x ./build-local.sh
        ./build-local.sh
    fi
else
    echo "Skipped release build."
fi
