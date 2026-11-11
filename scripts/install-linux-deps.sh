#!/usr/bin/env bash
# Installs what the Tauri Linux build needs on a GitHub Ubuntu runner.
#
# On 2026-11-11 the runners could not resolve azure.archive.ubuntu.com or security.ubuntu.com,
# and apt waited 20 s on each of 121 packages, so releases hung for over half an hour.
# So: first find an Ubuntu mirror that answers (on other domains too), point apt at it alone,
# then install with each command cut off after 4 minutes and retried up to 3 times.
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

# GitHub's own mirror first; the rest are on other domains in case Ubuntu's names don't resolve.
MIRRORS=(
  http://azure.archive.ubuntu.com/ubuntu
  http://archive.ubuntu.com/ubuntu
  https://mirrors.edge.kernel.org/ubuntu
  http://mirrors.mit.edu/ubuntu
  https://mirror.math.princeton.edu/pub/ubuntu
)

CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")

# Skip rebuilding the man-page index after installing; on GitHub's runners it takes minutes
# and nothing here reads man pages.
echo 'set man-db/auto-update false' | timeout 30 sudo debconf-communicate >/dev/null || true
sudo rm -f /var/lib/man-db/auto-update

pick_mirror() {
  for m in "${MIRRORS[@]}"; do
    if curl -fsS -o /dev/null --connect-timeout 5 --max-time 15 "$m/dists/$CODENAME/InRelease"; then
      echo "$m"
      return 0
    fi
    echo "::warning::Ubuntu mirror $m did not answer; trying the next." >&2
  done
  return 1
}

use_mirror() {
  local m=$1
  echo "Using Ubuntu mirror $m"
  # Replace the runner's Ubuntu sources (sources.list or 24.04's ubuntu.sources) with this
  # one mirror. Other repositories in sources.list.d (Microsoft etc.) are left alone.
  [ -f /etc/apt/sources.list.d/ubuntu.sources ] && sudo mv /etc/apt/sources.list.d/ubuntu.sources /etc/apt/ubuntu.sources.disabled
  sudo tee /etc/apt/sources.list >/dev/null <<EOF
deb $m $CODENAME main restricted universe
deb $m $CODENAME-updates main restricted universe
deb $m $CODENAME-security main restricted universe
EOF
}

APT=(sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20
     -o DPkg::Lock::Timeout=60)

for attempt in 1 2 3; do
  echo "::group::Attempt $attempt"
  if mirror=$(pick_mirror); then
    use_mirror "$mirror"
    # Only the Ubuntu lists matter; a broken third-party repository must not stop the install.
    timeout 240 "${APT[@]}" update || echo "::warning::apt-get update reported errors; trying the install anyway."
    if timeout 240 "${APT[@]}" install -y --no-install-recommends "${PACKAGES[@]}"; then
      echo "::endgroup::"
      exit 0
    fi
  else
    echo "::warning::No Ubuntu mirror answered."
  fi
  echo "::endgroup::"
  echo "::warning::Installing Linux dependencies failed (attempt $attempt of 3); retrying."
  # A killed apt can leave dpkg half-done; finish it before the next try.
  sudo dpkg --configure -a || true
  sleep $((attempt * 15))
done

echo "::error::Could not install Linux dependencies after 3 attempts."
exit 1
