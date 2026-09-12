---
name: designly-bridge
description: Design-to-code bridge for SVG optimization, design token / color palette extraction, and converting SVGs to clean React/JSX components.
---

# 🎨 Designly Bridge Plugin

Bridge connecting design assets, SVG mascots/icons, and palettes to web code components.

## 🛠️ CLI Interface & Invocations

Executable: `bun ~/.dsh/scripts/designly_bridge.mjs <action> <path>`

### 1. Optimize SVG Files (Zero Bloat)
Strip metadata, comments, and extra headers from SVG files:
```bash
bun ~/.dsh/scripts/designly_bridge.mjs optimize_svg /path/to/icon.svg
```

### 2. Extract Color Palettes
Scan CSS, HTML, or SVG files for HEX, RGB, and HSL color values:
```bash
bun ~/.dsh/scripts/designly_bridge.mjs extract_colors /path/to/styles.css
```

### 3. Convert SVG to React JSX
Format SVG attributes (`class` to `className`, `stroke-width` to `strokeWidth`, etc.) for React:
```bash
bun ~/.dsh/scripts/designly_bridge.mjs svg_to_jsx /path/to/icon.svg
```
