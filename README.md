# DeepSeek Harness Desktop (macOS) 🚀

[![CI](https://github.com/imMamdouhaboammar/deepseek-harness-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/imMamdouhaboammar/deepseek-harness-desktop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/imMamdouhaboammar/deepseek-harness-desktop?color=blue)](https://github.com/imMamdouhaboammar/deepseek-harness-desktop/releases)
[![npm version](https://img.shields.io/npm/v/deepseek-harness-macos?color=green)](https://www.npmjs.com/package/deepseek-harness-macos)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **The complete, installable macOS desktop app & daemon environment for DeepSeek Harness (`dsh`).**  
> Run DeepSeek Harness directly from your Dock or Applications with zero terminal hassle, automatic background daemon lifecycle, instant loopback authentication, and pre-packaged agent presets.

---

## 🌟 Highlights

- **⚡ Instant Launch from Dock**: Native macOS Mach-O app built with Swift & WebKit (`WKWebView`). No terminal windows, no Chrome tabs popping up.
- **🔄 Auto-Managed Background Daemon**: Managed by macOS `launchd` via `~/Library/LaunchAgents/com.deepseek.dsh.plist`. Auto-restarts on reboot or crash.
- **🔐 Zero-Token Loopback Auth**: Invariant engine automatically issues a secure authority-bound session cookie for `127.0.0.1`, eliminating 401 Unauthorized errors forever.
- **🛠️ Zero-Xcode Build Pipeline**: Compiles in **~2 seconds** using host `swiftc` and macOS SDK. No 40GB Xcode IDE required.
- **🧠 190+ Ready-to-Use Agent Presets**: Pre-configured specialized personas for engineering, research, design, architecture, and compliance.
- **🛡️ Resilient Failover & Router**: Multi-provider fallback across DeepSeek, AgentRouter, Tabitoken, and custom endpoints.

---

## 📦 Installation Options

### 1. One-Line Install (Recommended)
Open Terminal and run:
```bash
curl -fsSL https://raw.githubusercontent.com/imMamdouhaboammar/deepseek-harness-desktop/main/install.sh | bash
```

### 2. Via npm / Bun / npx
Install globally or run directly:
```bash
# Using npx directly
npx deepseek-harness-macos setup --open

# Or install globally with Bun
bun add -g deepseek-harness-macos
dsh-desktop setup --open
```

### 3. Download Standalone `.dmg`
Download the pre-compiled disk image from [GitHub Releases](https://github.com/deepseek-ai/deepseek-harness-desktop/releases/latest):
1. Open `DeepSeek-Harness-macOS.dmg`.
2. Drag **DeepSeek Harness** into your `/Applications` folder.
3. Launch `DeepSeek Harness` from your Applications or Dock!

---

## 💻 CLI Commands Reference

`dsh-desktop` provides complete control over the app, background service, and agent environment:

| Command | Description |
|---|---|
| `dsh-desktop setup` | Build native app, install to `/Applications`, scaffold `~/.dsh`, and register LaunchAgent. |
| `dsh-desktop status` | Check status of the app, background daemon, port 3080, and process PID. |
| `dsh-desktop doctor` | Run comprehensive system diagnostics (Swift, runtimes, binary, ports, invariants). |
| `dsh-desktop start` | Start the background daemon via `launchctl`. |
| `dsh-desktop stop` | Stop the background daemon and clean up port 3080 processes. |
| `dsh-desktop restart` | Gracefully restart the daemon. |
| `dsh-desktop open` | Launch the native `/Applications/DeepSeek Harness.app`. |
| `dsh-desktop invariants`| Manually run the invariant guard engine (auto-auth & lazy catalog). |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│             DeepSeek Harness.app (Native)              │
│  - macOS Frameless Transparent NSWindow                │
│  - Swift + WebKit (WKWebView)                          │
│  - Native Bridge (Notifications, Screen, File Open)    │
│  - Injected UI Enhancements (Mentions, Theme)          │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP (127.0.0.1:3080)
┌───────────────────────────▼────────────────────────────┐
│          Background Daemon (com.deepseek.dsh)          │
│  - Managed by launchd (RunAtLoad, KeepAlive)           │
│  - dsh web --no-open --port 3080                       │
│  - Invariant Guard (Loopback Auth Cookie Engine)       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│               ~/.dsh Agent Environment                 │
│  - plugins/ (autoharness, router-hunter, fable)        │
│  - .agent-presets/ (190+ persona agents)               │
│  - scripts/ (failover router, mcp hub, provider keys)  │
│  - settings.yaml & cordis.patch.yml                    │
└────────────────────────────────────────────────────────┘
```

---

## 🛠️ Development & Building from Source

```bash
# Clone the repository
git clone https://github.com/imMamdouhaboammar/deepseek-harness-desktop.git
cd deepseek-harness-desktop

# Install dependencies (Bun mandatory per project constitution)
bun install

# Compile the native macOS app (produces build/DeepSeek Harness.app)
bun run build:app

# Package into macOS DMG disk image
bun run package:dmg

# Test diagnostics
bun run doctor
```

## 📄 License

MIT © DeepSeek Harness Community

## Gate 8 recovery tooling

Optional Node 24 tooling packages the verified Maestro v4 compatibility patch and a time-based, PID-targeted recovery trial runner. It has no Playwright dependency and does not change the running DSH profile during installation or tests.

```sh
npm run test:gate8
npm run test:maestro
```

See [results and limits](docs/gate8-results.md) and [patch application / reproduction](docs/gate8-reproduction.md). Local credentials, session journals, configuration snapshots, and raw trial logs remain outside Git.
