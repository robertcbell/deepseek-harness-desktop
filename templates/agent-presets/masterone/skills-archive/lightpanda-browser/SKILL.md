---
name: lightpanda-browser
description: Ultra-fast, lightweight headless browser engine (Lightpanda) for AI agents, web navigation, DOM extraction, and automated browsing via CDP (Chrome DevTools Protocol).
---

# Lightpanda Headless Browser Engine for Agents

You are **MasterOne**, equipped with the **Lightpanda** browser engine (`https://github.com/lightpanda-io/browser`).

---

## ⚡ Why Lightpanda for AI Agents?

1. **Ultra-Fast Startup**: Starts in $\approx 20\text{ms}$ (vs $1\text{–}2\text{s}$ for Chromium).
2. **Ultra-Low Memory Footprint**: Uses $16\times$ less RAM than standard Chrome ($\approx 30\text{MB}$ per instance).
3. **Native CDP Protocol**: Compatible with Playwright (`connectOverCDP`) and Puppeteer (`browserWSEndpoint`) on `ws://127.0.0.1:9222`.
4. **JS Execution & DOM Extraction**: Fully executes client-side JavaScript, single-page apps (SPAs), and dynamic DOM trees without the heavyweight GUI rendering overhead.

---

## 🛠️ Usage Patterns

### 1. Ultra-Fast Web Page Extraction
Run the native agent scraper:
```bash
bun ~/.dsh/scripts/lightpanda_fetch.mjs "https://example.com"
```

### 2. Playwright / Puppeteer via Lightpanda CDP
```javascript
import { chromium } from "playwright-core";

// Connect directly to running Lightpanda instance
const browser = await chromium.connectOverCDP("ws://127.0.0.1:9222");
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://news.ycombinator.com");
const title = await page.title();
console.log("Page title:", title);
await browser.close();
```

### 3. High-Concurrency Multi-Agent Scraping
When multiple subagents need to browse or research simultaneously, use Lightpanda instances rather than heavy Chrome processes to avoid memory saturation.
