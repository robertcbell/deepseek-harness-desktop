#!/usr/bin/env bash
# DeepSeek Harness Desktop - Universal 1-Line Installer for macOS
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/imMamdouhaboammar/deepseek-harness-desktop/main/install.sh | bash
set -e

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}"
echo "  ____                  ____            _      _   _                                "
echo " |  _ \  ___  ___ _ __ / ___|  ___  ___| | __ | | | | __ _ _ __ _ __   ___  ___ ___ "
echo " | | | |/ _ \/ _ \ '_ \\___ \ / _ \/ _ \ |/ / | |_| |/ _\` | '__| '_ \ / _ \/ __/ __|"
echo " | |_| |  __/  __/ |_) |___) |  __/  __/   <  |  _  | (_| | |  | | | |  __/\__ \__ \\"
echo " |____/ \___|\___| .__/|____/ \___|\___|_|\_\ |_| |_|\__,_|_|  |_| |_|\___||___/___/"
echo "                 |_|                                                                 "
echo -e "${RESET}"
echo -e "${BOLD}DeepSeek Harness macOS Native Desktop App & Daemon Installer${RESET}\n"

# 1. Platform verification
if [ "$(uname)" != "Darwin" ]; then
  echo -e "${RED}Error: DeepSeek Harness Desktop is only supported on macOS.${RESET}" >&2
  exit 1
fi

ARCH="$(uname -m)"
echo -e "${GREEN}✔${RESET} Detected macOS architecture: ${BOLD}${ARCH}${RESET}"

# 2. Check Xcode Command Line Tools (swiftc)
if ! command -v swiftc >/dev/null 2>&1; then
  echo -e "${YELLOW}Notice: Xcode Command Line Tools (swiftc) required to compile native app.${RESET}"
  echo "Installing Xcode Command Line Tools..."
  xcode-select --install || true
  echo "Please complete the prompt and rerun this script."
  exit 1
fi
echo -e "${GREEN}✔${RESET} Swift compiler verified: $(command -v swiftc)"

# 3. Check JavaScript runtime (Bun or Node)
if ! command -v bun >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}Notice: Bun runtime not found. Installing Bun...${RESET}"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if command -v bun >/dev/null 2>&1; then
  JS_RUNNER="bun"
  echo -e "${GREEN}✔${RESET} JavaScript runtime: Bun ($(bun --version))"
elif command -v node >/dev/null 2>&1; then
  JS_RUNNER="node"
  echo -e "${GREEN}✔${RESET} JavaScript runtime: Node ($(node --version))"
fi

# 4. Check @deepseek-ai/dsh
if ! command -v dsh >/dev/null 2>&1 && [ ! -x "/opt/homebrew/bin/dsh" ] && [ ! -x "$HOME/.bun/bin/dsh" ]; then
  echo -e "${YELLOW}Notice: @deepseek-ai/dsh CLI not detected in PATH.${RESET}"
  echo "Installing @deepseek-ai/dsh..."
  if command -v bun >/dev/null 2>&1; then
    bun add -g @deepseek-ai/dsh
  else
    npm install -g @deepseek-ai/dsh
  fi
fi

# 5. Check if running from inside the cloned repository
INSTALL_DIR=""
if [ -f "bin/dsh-desktop.mjs" ] && [ -f "app/build.sh" ]; then
  INSTALL_DIR="$(pwd)"
else
  INSTALL_DIR="$HOME/.dsh-desktop-installer"
  echo -e "Fetching latest release into ${CYAN}${INSTALL_DIR}${RESET}..."
  rm -rf "$INSTALL_DIR"
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 https://github.com/imMamdouhaboammar/deepseek-harness-desktop.git "$INSTALL_DIR"
  else
    mkdir -p "$INSTALL_DIR"
    curl -fsSL https://github.com/imMamdouhaboammar/deepseek-harness-desktop/archive/refs/heads/main.tar.gz | tar -xz -C "$INSTALL_DIR" --strip-components=1
  fi
fi

# 6. Install dependencies and run setup
cd "$INSTALL_DIR"
echo -e "\nInstalling package dependencies..."
if command -v bun >/dev/null 2>&1; then
  bun install
else
  npm install
fi

echo -e "\nExecuting desktop setup..."
$JS_RUNNER bin/dsh-desktop.mjs setup --open

echo -e "\n${BOLD}${GREEN}🎉 Installation successfully finished!${RESET}"
echo -e "You can now run DeepSeek Harness directly from your Applications folder or Dock."
