#!/usr/bin/env bash
# Installs what the Tauri Linux build needs on a GitHub Ubuntu runner.
#
# GitHub's apt mirror sometimes stalls mid-download and apt then waits forever (one release
# sat here for over half an hour). Each attempt is cut off after 4 minutes per command and tried again,
# up to 3 times, so a stall costs minutes, not the release.
set -uo pipefail

PACKAGES=(
  libwebkit2gtk-4.1-dev
  librsvg2-dev
  patchelf
  libssl-dev
  pkg-config
  build-essential
  libgtk-3-dev
  libayatana-appindicator3-dev
)

# Skip rebuilding the man-page index after installing; on GitHub's runners it takes minutes
# and nothing here reads man pages.
echo 'set man-db/auto-update false' | sudo debconf-communicate >/dev/null || true
sudo rm -f /var/lib/man-db/auto-update

APT=(sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30
     -o DPkg::Lock::Timeout=60)

for attempt in 1 2 3; do
  echo "::group::Attempt $attempt"
  if timeout 240 "${APT[@]}" update &&
     timeout 240 "${APT[@]}" install -y --no-install-recommends "${PACKAGES[@]}"; then
    echo "::endgroup::"
    exit 0
  fi
  echo "::endgroup::"
  echo "::warning::Installing Linux dependencies failed or stalled (attempt $attempt of 3); retrying."
  # A killed apt can leave dpkg half-done; finish it before the next try.
  sudo dpkg --configure -a || true
  sleep $((attempt * 10))
done

echo "::error::Could not install Linux dependencies after 3 attempts."
exit 1
