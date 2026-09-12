#!/usr/bin/env node
/**
 * DeepSeek Harness Desktop CLI & Environment Manager
 * Unified tooling to build, install, manage, and verify DeepSeek Harness macOS app & daemon.
 */

import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");

const HOME = process.env.HOME || os.homedir();
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, ".dsh");
const APP_NAME = "DeepSeek Harness.app";
const APPLICATIONS_APP = path.join("/Applications", APP_NAME);
const LOCAL_APP = path.join(PKG_ROOT, "build", APP_NAME);
const LAUNCH_AGENT_PLIST = path.join(HOME, "Library/LaunchAgents/com.deepseek.dsh.plist");

// Helper: Ensure Darwin
function ensureDarwin() {
  if (process.platform !== "darwin") {
    console.error(chalk.red("Error: DeepSeek Harness Desktop is designed exclusively for macOS."));
    process.exit(1);
  }
}

// Helper: Run command with output suppressed unless error
function runCmd(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: "pipe",
      ...options
    }).trim();
  } catch (err) {
    throw new Error(`Command failed: ${cmd}\n${err.stderr || err.message}`);
  }
}

// Helper: Port health check
function checkHealth(port = 3080, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        timeout: timeoutMs
      },
      (res) => {
        resolve({ alive: true, statusCode: res.statusCode });
      }
    );
    req.on("error", () => resolve({ alive: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ alive: false, timeout: true });
    });
  });
}

// Helper: Locate binaries
function findBinary(name, extraCandidates = []) {
  try {
    const fromPath = execSync(`command -v ${name} 2>/dev/null`, { encoding: "utf8" }).trim();
    if (fromPath && fs.existsSync(fromPath)) return fromPath;
  } catch {}

  for (const candidate of extraCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const dshBin = () =>
  findBinary("dsh", [
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh",
    path.join(HOME, ".bun/bin/dsh")
  ]);

const bunBin = () =>
  findBinary("bun", [
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    path.join(HOME, ".bun/bin/bun")
  ]);

const swiftcBin = () =>
  findBinary("swiftc", [
    "/usr/bin/swiftc",
    "/Library/Developer/CommandLineTools/usr/bin/swiftc"
  ]);

// --- CLI Commands ---

program
  .name("dsh-desktop")
  .description("DeepSeek Harness Native macOS Desktop & Daemon Manager")
  .version("0.0.1");

// 1. SETUP
program
  .command("setup")
  .description("Build, install, and configure DeepSeek Harness app and daemon")
  .option("-f, --force", "Force re-build and overwrite existing installation")
  .option("--no-dock", "Skip pinning DeepSeek Harness to macOS Dock")
  .option("--open", "Open DeepSeek Harness immediately after setup completes")
  .action(async (options) => {
    ensureDarwin();
    console.log(chalk.bold.cyan("\n🚀 Setting up DeepSeek Harness Desktop...\n"));

    // 1. Check prerequisites
    const spinPre = ora("Checking environment prerequisites...").start();
    const swift = swiftcBin();
    if (!swift) {
      spinPre.fail("Xcode Command Line Tools / swiftc not found. Run: xcode-select --install");
      process.exit(1);
    }
    const dsh = dshBin();
    if (!dsh) {
      spinPre.warn(
        "Warning: 'dsh' binary not found in PATH. Install with: bun add -g @deepseek-ai/dsh"
      );
    } else {
      spinPre.succeed(`Prerequisites verified (swiftc: ${swift}, dsh: ${dsh})`);
    }

    // 2. Build app if needed
    const shouldBuild = options.force || !fs.existsSync(LOCAL_APP);
    if (shouldBuild) {
      const spinBuild = ora("Compiling native Swift macOS application...").start();
      try {
        execSync("bash app/build.sh", { cwd: PKG_ROOT, stdio: "pipe" });
        spinBuild.succeed("Compiled DeepSeek Harness.app with native swiftc");
      } catch (err) {
        spinBuild.fail(`Build failed: ${err.message}`);
        process.exit(1);
      }
    } else {
      console.log(chalk.green("✔ Using existing build of DeepSeek Harness.app"));
    }

    // 3. Install to /Applications
    const spinInstall = ora("Installing to /Applications/DeepSeek Harness.app...").start();
    try {
      if (fs.existsSync(APPLICATIONS_APP)) {
        runCmd(`rm -rf "${APPLICATIONS_APP}"`);
      }
      runCmd(`cp -R "${LOCAL_APP}" "${APPLICATIONS_APP}"`);
      runCmd(`codesign -s - --force --deep "${APPLICATIONS_APP}" 2>/dev/null || true`);
      spinInstall.succeed("Installed DeepSeek Harness.app to /Applications");
    } catch (err) {
      spinInstall.fail(`Installation failed: ${err.message}`);
      process.exit(1);
    }

    // 4. Scaffold ~/.dsh directories
    const spinDsh = ora("Configuring ~/.dsh environment and scripts...").start();
    try {
      const dirs = [
        DSH_HOME,
        path.join(DSH_HOME, "logs"),
        path.join(DSH_HOME, "scripts"),
        path.join(DSH_HOME, "plugins"),
        path.join(DSH_HOME, "templates"),
        path.join(DSH_HOME, ".agent-presets")
      ];
      for (const d of dirs) {
        fs.mkdirSync(d, { recursive: true });
      }

      // Copy daemon scripts
      fs.copyFileSync(
        path.join(PKG_ROOT, "daemon/dsh_daemon.sh"),
        path.join(DSH_HOME, "scripts/dsh_daemon.sh")
      );
      fs.chmodSync(path.join(DSH_HOME, "scripts/dsh_daemon.sh"), 0o755);

      fs.copyFileSync(
        path.join(PKG_ROOT, "daemon/enforce_invariants.mjs"),
        path.join(DSH_HOME, "scripts/enforce_dsh_invariants.mjs")
      );
      fs.chmodSync(path.join(DSH_HOME, "scripts/enforce_dsh_invariants.mjs"), 0o755);

      // Copy auxiliary scripts
      const auxScripts = [
        "injected_bundle.js",
        "macos_bridge.mjs",
        "mcp_hub.mjs",
        "set_provider_key.mjs",
        "dsh-router.mjs",
        "failover_router.mjs"
      ];
      for (const s of auxScripts) {
        const src = path.join(PKG_ROOT, "scripts", s);
        const dst = path.join(DSH_HOME, "scripts", s);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
          if (s.endsWith(".mjs") || s.endsWith(".sh")) {
            fs.chmodSync(dst, 0o755);
          }
        }
      }

      // Copy plugins if not already present
      const pluginsSrc = path.join(PKG_ROOT, "plugins");
      if (fs.existsSync(pluginsSrc)) {
        const plugins = fs.readdirSync(pluginsSrc);
        for (const p of plugins) {
          const pSrc = path.join(pluginsSrc, p);
          const pDst = path.join(DSH_HOME, "plugins", p);
          if (!fs.existsSync(pDst) || options.force) {
            runCmd(`cp -R "${pSrc}" "${pDst}"`);
          }
        }
      }

      // Copy templates / agent presets
      const presetsSrc = path.join(PKG_ROOT, "templates/agent-presets");
      if (fs.existsSync(presetsSrc)) {
        const presets = fs.readdirSync(presetsSrc);
        for (const pr of presets) {
          const prSrc = path.join(presetsSrc, pr);
          const prDst = path.join(DSH_HOME, ".agent-presets", pr);
          if (!fs.existsSync(prDst) || options.force) {
            runCmd(`cp -R "${prSrc}" "${prDst}"`);
          }
        }
      }

      // Default cordis.patch.yml
      const patchDst = path.join(DSH_HOME, "cordis.patch.yml");
      if (!fs.existsSync(patchDst)) {
        fs.copyFileSync(path.join(PKG_ROOT, "templates/cordis.patch.yml"), patchDst);
      }

      // Default settings.yaml
      const settingsDst = path.join(DSH_HOME, "settings.yaml");
      if (!fs.existsSync(settingsDst)) {
        fs.copyFileSync(path.join(PKG_ROOT, "templates/settings.example.yaml"), settingsDst);
      }

      spinDsh.succeed("Configured ~/.dsh directory structure, plugins, presets, and scripts");
    } catch (err) {
      spinDsh.fail(`DSH scaffolding failed: ${err.message}`);
      process.exit(1);
    }

    // 5. Register LaunchAgent
    const spinAgent = ora("Configuring background LaunchAgent service...").start();
    try {
      const launchAgentsDir = path.join(HOME, "Library/LaunchAgents");
      fs.mkdirSync(launchAgentsDir, { recursive: true });

      const plistTemplate = fs.readFileSync(
        path.join(PKG_ROOT, "daemon/com.deepseek.dsh.plist"),
        "utf8"
      );
      const plistRendered = plistTemplate.replace(/\{\{DSH_HOME\}\}/g, DSH_HOME);
      fs.writeFileSync(LAUNCH_AGENT_PLIST, plistRendered, "utf8");

      // Reload LaunchAgent
      try {
        runCmd(`launchctl unload "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true`);
        runCmd(`launchctl load -w "${LAUNCH_AGENT_PLIST}"`);
        const uid = process.getuid();
        runCmd(`launchctl kickstart -k "gui/${uid}/com.deepseek.dsh" 2>/dev/null || true`);
      } catch {}

      spinAgent.succeed("Registered LaunchAgent: ~/Library/LaunchAgents/com.deepseek.dsh.plist");
    } catch (err) {
      spinAgent.fail(`LaunchAgent registration failed: ${err.message}`);
    }

    // 6. Enforce Invariants
    const spinInv = ora("Applying runtime invariants (auto-auth & lazy catalog)...").start();
    try {
      const invariantScript = path.join(DSH_HOME, "scripts/enforce_dsh_invariants.mjs");
      if (fs.existsSync(invariantScript)) {
        const bun = bunBin();
        if (bun) {
          runCmd(`"${bun}" "${invariantScript}"`);
        } else {
          runCmd(`node "${invariantScript}"`);
        }
      }
      spinInv.succeed("Applied DSH invariants successfully");
    } catch (err) {
      spinInv.warn(`Invariants notice: ${err.message}`);
    }

    // 7. Verify Port 3080 Health
    const spinHealth = ora("Verifying daemon health on http://127.0.0.1:3080...").start();
    let isHealthy = false;
    for (let i = 0; i < 15; i++) {
      const res = await checkHealth(3080, 1000);
      if (res.alive) {
        isHealthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    if (isHealthy) {
      spinHealth.succeed("Daemon active and responding on http://127.0.0.1:3080");
    } else {
      spinHealth.warn("Daemon starting up or pending first launch request.");
    }

    // 8. Dock integration
    if (options.dock !== false) {
      try {
        const appleScript = `
          tell application "System Events"
            tell appearance preferences
              -- check if dock item exists
            end tell
          end tell
        `;
        // Use defaults write / killall Dock or inform user
        console.log(chalk.gray("ℹ DeepSeek Harness ready in /Applications. Drag to Dock or launch from Spotlight."));
      } catch {}
    }

    console.log(chalk.bold.green("\n✨ DeepSeek Harness Desktop setup completed successfully!\n"));
    console.log(`  • App Location: ${chalk.cyan("/Applications/DeepSeek Harness.app")}`);
    console.log(`  • Web Interface: ${chalk.cyan("http://127.0.0.1:3080")}`);
    console.log(`  • Logs: ${chalk.cyan("~/.dsh/logs/daemon.log")}`);
    console.log(`  • Status check: ${chalk.yellow("dsh-desktop status")}\n`);

    if (options.open) {
      runCmd(`open "${APPLICATIONS_APP}"`);
    }
  });

// 2. STATUS
program
  .command("status")
  .description("Check daemon, port 3080, and desktop app status")
  .action(async () => {
    ensureDarwin();
    console.log(chalk.bold("\n🔍 DeepSeek Harness Status Check:\n"));

    // App Check
    const appInstalled = fs.existsSync(APPLICATIONS_APP);
    console.log(
      `  Application:   ${appInstalled ? chalk.green("Installed (/Applications/DeepSeek Harness.app)") : chalk.red("Not installed in /Applications")}`
    );

    // LaunchAgent Check
    let agentLoaded = false;
    try {
      const out = execSync("launchctl list 2>/dev/null", { encoding: "utf8" });
      agentLoaded = out.includes("com.deepseek.dsh");
    } catch {}
    console.log(
      `  LaunchAgent:   ${agentLoaded ? chalk.green("Registered & Loaded (com.deepseek.dsh)") : chalk.yellow("Not loaded")}`
    );

    // Port 3080 Check
    const health = await checkHealth(3080);
    if (health.alive) {
      console.log(`  Port 3080:     ${chalk.green("ONLINE (http://127.0.0.1:3080)")}`);
    } else {
      console.log(`  Port 3080:     ${chalk.red("OFFLINE")}`);
    }

    // Process Info
    try {
      const pids = execSync("lsof -ti tcp:3080 -sTCP:LISTEN 2>/dev/null", { encoding: "utf8" }).trim();
      if (pids) {
        const psInfo = execSync(`ps -p ${pids.split("\n")[0]} -o pid,user,%cpu,%mem,command 2>/dev/null`, {
          encoding: "utf8"
        }).trim();
        console.log(`\n  Active Process:\n  ${chalk.gray(psInfo.split("\n").join("\n  "))}\n`);
      }
    } catch {}
  });

// 3. START
program
  .command("start")
  .description("Start the DeepSeek Harness background daemon")
  .action(async () => {
    ensureDarwin();
    const spin = ora("Starting DeepSeek Harness daemon...").start();
    try {
      const uid = process.getuid();
      runCmd(`launchctl kickstart -k "gui/${uid}/com.deepseek.dsh" 2>/dev/null || launchctl load -w "${LAUNCH_AGENT_PLIST}"`);
      await new Promise((r) => setTimeout(r, 1500));
      const health = await checkHealth(3080);
      if (health.alive) {
        spin.succeed("Daemon started successfully on http://127.0.0.1:3080");
      } else {
        spin.info("Daemon started. Waiting for initialization...");
      }
    } catch (err) {
      spin.fail(`Failed to start daemon: ${err.message}`);
    }
  });

// 4. STOP
program
  .command("stop")
  .description("Stop the DeepSeek Harness background daemon")
  .action(async () => {
    ensureDarwin();
    const spin = ora("Stopping DeepSeek Harness daemon...").start();
    try {
      try {
        runCmd(`launchctl unload "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true`);
      } catch {}
      try {
        const pids = runCmd("lsof -ti tcp:3080 -sTCP:LISTEN 2>/dev/null || true");
        if (pids) {
          runCmd(`echo "${pids}" | xargs kill -9 2>/dev/null || true`);
        }
      } catch {}
      spin.succeed("DeepSeek Harness daemon stopped.");
    } catch (err) {
      spin.fail(`Failed to stop daemon: ${err.message}`);
    }
  });

// 5. RESTART
program
  .command("restart")
  .description("Restart the DeepSeek Harness background daemon")
  .action(async () => {
    ensureDarwin();
    const spin = ora("Restarting DeepSeek Harness daemon...").start();
    try {
      try {
        const pids = runCmd("lsof -ti tcp:3080 -sTCP:LISTEN 2>/dev/null || true");
        if (pids) {
          runCmd(`echo "${pids}" | xargs kill -9 2>/dev/null || true`);
        }
      } catch {}
      const uid = process.getuid();
      runCmd(`launchctl kickstart -k "gui/${uid}/com.deepseek.dsh" 2>/dev/null || launchctl load -w "${LAUNCH_AGENT_PLIST}"`);
      await new Promise((r) => setTimeout(r, 2000));
      const health = await checkHealth(3080);
      if (health.alive) {
        spin.succeed("Daemon restarted and healthy on http://127.0.0.1:3080");
      } else {
        spin.info("Daemon restart signal sent.");
      }
    } catch (err) {
      spin.fail(`Failed to restart daemon: ${err.message}`);
    }
  });

// 6. DOCTOR
program
  .command("doctor")
  .description("Run deep system diagnostics on DeepSeek Harness")
  .action(async () => {
    ensureDarwin();
    console.log(chalk.bold.cyan("\n🩺 DeepSeek Harness System Diagnostics\n"));

    const check = (label, ok, details = "") => {
      const symbol = ok ? chalk.green("✔") : chalk.red("✖");
      console.log(`  ${symbol} ${chalk.bold(label)}: ${ok ? chalk.green(details || "OK") : chalk.red(details || "Failed")}`);
    };

    // OS
    check("macOS Architecture", true, `${os.type()} ${os.release()} (${os.arch()})`);

    // Swiftc
    const swift = swiftcBin();
    check("Swift Compiler", !!swift, swift || "Missing - Install Xcode CLI tools");

    // Bun / Node
    const bun = bunBin();
    check("Bun Runtime", !!bun, bun || "Missing");
    const node = findBinary("node");
    check("Node.js Runtime", !!node, node || "Missing");

    // DSH Binary
    const dsh = dshBin();
    check("Global DSH CLI", !!dsh, dsh || "Missing - run: bun add -g @deepseek-ai/dsh");

    // App Bundle
    const appExists = fs.existsSync(APPLICATIONS_APP);
    check("/Applications Bundle", appExists, appExists ? "Installed" : "Run: dsh-desktop setup");

    // LaunchAgent
    const plistExists = fs.existsSync(LAUNCH_AGENT_PLIST);
    check("LaunchAgent Plist", plistExists, plistExists ? LAUNCH_AGENT_PLIST : "Missing");

    // Daemon Port 3080
    const health = await checkHealth(3080);
    check("Daemon Port 3080", health.alive, health.alive ? "Online (Healthy)" : "Offline");

    // Invariant Script
    const invScript = path.join(DSH_HOME, "scripts/enforce_dsh_invariants.mjs");
    check("Invariant Guard Script", fs.existsSync(invScript), invScript);

    // Settings File
    const settings = path.join(DSH_HOME, "settings.yaml");
    check("DSH Settings", fs.existsSync(settings), settings);

    console.log("");
  });

// 7. OPEN
program
  .command("open")
  .description("Launch the DeepSeek Harness native desktop application")
  .action(() => {
    ensureDarwin();
    if (fs.existsSync(APPLICATIONS_APP)) {
      runCmd(`open "${APPLICATIONS_APP}"`);
      console.log(chalk.green("✔ Opened /Applications/DeepSeek Harness.app"));
    } else if (fs.existsSync(LOCAL_APP)) {
      runCmd(`open "${LOCAL_APP}"`);
      console.log(chalk.green(`✔ Opened ${LOCAL_APP}`));
    } else {
      console.error(chalk.red("Application not found. Run 'dsh-desktop setup' first."));
      process.exit(1);
    }
  });

// 8. INVARIANTS
program
  .command("invariants")
  .description("Enforce runtime invariants (loopback auto-auth, lazy catalog)")
  .action(() => {
    ensureDarwin();
    const invScript = path.join(DSH_HOME, "scripts/enforce_dsh_invariants.mjs");
    const scriptToRun = fs.existsSync(invScript) ? invScript : path.join(PKG_ROOT, "daemon/enforce_invariants.mjs");
    const bun = bunBin();
    if (bun) {
      spawnSync(bun, [scriptToRun], { stdio: "inherit" });
    } else {
      spawnSync("node", [scriptToRun], { stdio: "inherit" });
    }
  });

program.parse(process.argv);
