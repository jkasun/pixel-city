#!/bin/sh
# Pixel City installer
# Usage: curl -fsSL https://raw.githubusercontent.com/jkasun/pixel-city/main/install.sh | sh

set -eu

REPO="jkasun/pixel-city"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

c_red()  { printf '\033[31m%s\033[0m' "$1"; }
c_green(){ printf '\033[32m%s\033[0m' "$1"; }
c_blue() { printf '\033[34m%s\033[0m' "$1"; }
c_dim()  { printf '\033[2m%s\033[0m' "$1"; }

info() { printf '%s %s\n' "$(c_blue '==>')" "$1"; }
ok()   { printf '%s %s\n' "$(c_green ' OK')" "$1"; }
warn() { printf '%s %s\n' "$(c_red 'WARN')" "$1"; }
die()  { printf '%s %s\n' "$(c_red 'ERR ')" "$1" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required tool: $1"
}

resolve_version() {
  url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/${REPO}/releases/latest" 2>/dev/null) || {
    die "Could not reach github.com/${REPO}/releases/latest"
  }
  case "$url" in
    */tag/*)
      printf '%s' "$url" | sed -E 's#.*/tag/v?##'
      ;;
    *)
      die "No releases published yet for ${REPO}. See https://github.com/${REPO}/releases"
      ;;
  esac
}

detect_platform() {
  uname_s=$(uname -s)
  uname_m=$(uname -m)

  case "$uname_s" in
    Darwin) os="mac" ;;
    Linux)  os="linux" ;;
    *) die "Unsupported OS: $uname_s. (Windows builds aren't published yet — you can build from source: https://github.com/${REPO}#from-source)" ;;
  esac

  case "$uname_m" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) die "Unsupported architecture: $uname_m" ;;
  esac
}

install_mac() {
  require curl
  require unzip
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  # Resolve the versioned filename via the /latest redirect.
  # We use the predictable pattern PixelCity-<version>-mac-<arch>.dmg.
  # GitHub redirects /releases/latest/download/<name> to the tagged asset.
  pattern="PixelCity-*-mac-${arch}.dmg"
  info "Resolving latest release for mac/${arch}…"
  version=$(resolve_version) || exit 1
  asset="PixelCity-${version}-mac-${arch}.dmg"
  url="${BASE_URL}/${asset}"

  info "Downloading ${asset}"
  curl -fL --progress-bar -o "${tmpdir}/${asset}" "$url" \
    || die "Download failed: ${url}"

  info "Mounting DMG"
  mount_out=$(hdiutil attach "${tmpdir}/${asset}" -nobrowse)
  mount_point=$(printf '%s\n' "$mount_out" | grep -o '/Volumes/.*' | tail -1 | sed 's/[[:space:]]*$//')
  [ -d "$mount_point" ] || die "Could not find DMG mount point"

  app_src="${mount_point}/Pixel City.app"
  app_dst="/Applications/Pixel City.app"
  [ -d "$app_src" ] || { hdiutil detach "$mount_point" -quiet; die "App not found inside DMG"; }

  if [ -d "$app_dst" ]; then
    info "Removing existing /Applications/Pixel City.app"
    rm -rf "$app_dst"
  fi

  info "Copying to /Applications"
  cp -R "$app_src" "/Applications/"
  hdiutil detach "$mount_point" -quiet || true

  info "Removing quarantine flag"
  xattr -dr com.apple.quarantine "$app_dst" 2>/dev/null || true

  info "Applying ad-hoc signature"
  codesign --force --deep --sign - "$app_dst" >/dev/null 2>&1 || \
    warn "Ad-hoc codesign failed — app may still launch, but if not run: codesign --force --deep --sign - '$app_dst'"

  ok "Installed Pixel City ${version} → /Applications/Pixel City.app"
}

install_linux() {
  require curl
  bin_dir="${HOME}/.local/bin"
  mkdir -p "$bin_dir"

  info "Resolving latest release for linux/${arch}…"
  version=$(resolve_version) || exit 1
  # electron-builder's AppImage target uses platform-native arch names
  # (x86_64 for x64), not our normalized x64/arm64 tokens. Translate.
  case "$arch" in
    x64)   linux_arch="x86_64" ;;
    arm64) linux_arch="arm64" ;;
    *)     linux_arch="$arch" ;;
  esac
  asset="PixelCity-${version}-linux-${linux_arch}.AppImage"
  url="${BASE_URL}/${asset}"
  dst="${bin_dir}/pixelcity"

  info "Downloading ${asset}"
  curl -fL --progress-bar -o "$dst" "$url" \
    || die "Download failed: ${url}"
  chmod +x "$dst"

  ok "Installed Pixel City ${version} → ${dst}"
  case ":$PATH:" in
    *":${bin_dir}:"*) ;;
    *) warn "${bin_dir} is not on your PATH. Add it to your shell rc:"
       printf '       export PATH="%s:$PATH"\n' "$bin_dir" ;;
  esac
}

check_agent_clis() {
  printf '\n%s\n' "$(c_blue '==>') Checking for coding agent CLIs"

  found=0
  if command -v claude >/dev/null 2>&1; then
    ok "claude    → $(command -v claude)"
    found=$((found + 1))
  else
    printf '  %s claude    not found    %s\n' \
      "$(c_red '✗')" "$(c_dim 'install: npm i -g @anthropic-ai/claude-code   (docs: https://docs.anthropic.com/en/docs/claude-code)')"
  fi

  if command -v codex >/dev/null 2>&1; then
    ok "codex     → $(command -v codex)"
    found=$((found + 1))
  else
    printf '  %s codex     not found    %s\n' \
      "$(c_red '✗')" "$(c_dim 'install: npm i -g @openai/codex   (https://github.com/openai/codex)')"
  fi

  if [ "$found" -eq 0 ]; then
    printf '\n'
    warn "Pixel City needs at least one of these on your PATH to spawn employees."
    warn "Install one of the above before launching the app."
  fi
}

main() {
  printf '\n%s Pixel City installer\n\n' "$(c_blue '◆')"
  detect_platform
  case "$os" in
    mac)   install_mac ;;
    linux) install_linux ;;
  esac
  check_agent_clis

  printf '\n%s\n' "$(c_green 'Done.') Launch Pixel City and pick a project folder."
}

main "$@"
