---
name: macos-bridge
description: Native macOS integration plugin for sending native notification banners with sound, taking silent desktop/window screenshots for visual QA, opening files in Xcode/VSCode/Finder, and audible speech.
---

# 🍏 macOS Bridge Plugin

Native system utilities connecting MasterOne directly to macOS APIs.

## 🛠️ CLI Interface & Invocations

Executable: `bun ~/.dsh/scripts/macos_bridge.mjs <action> [arguments]`

### 1. Native macOS Notification
Send a system notification banner with sound when a long task completes:
```bash
bun ~/.dsh/scripts/macos_bridge.mjs notify "MasterOne" "Build completed successfully!" "Glass"
```

### 2. Silent Screenshot (Visual QA)
Capture the current screen to inspect rendered UI or web apps:
```bash
bun ~/.dsh/scripts/macos_bridge.mjs screenshot "/tmp/ui_audit.png"
```

### 3. Open in Dedicated Editor / Finder
Open a project, file, or workspace directly in VS Code, Xcode, or Finder:
```bash
bun ~/.dsh/scripts/macos_bridge.mjs open vscode /path/to/project
bun ~/.dsh/scripts/macos_bridge.mjs open xcode /path/to/project.xcodeproj
bun ~/.dsh/scripts/macos_bridge.mjs open finder /path/to/directory
```

### 4. Native Voice Announcement
Audibly speak a completion message:
```bash
bun ~/.dsh/scripts/macos_bridge.mjs say "Deployment finished"
```
