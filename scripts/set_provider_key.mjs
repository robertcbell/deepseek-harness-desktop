#!/usr/bin/env bun
/**
 * DSH / MasterOne Provider Key & Settings Manager
 * 
 * Usage:
 *   bun ~/.dsh/scripts/set_provider_key.mjs tabitoken <NEW_API_KEY> [OPTIONAL_BASE_URL]
 *   bun ~/.dsh/scripts/set_provider_key.mjs agentrouter <NEW_API_KEY> [OPTIONAL_BASE_URL]
 */
import fs from "fs";
import path from "path";
import os from "os";
import * as yaml from "js-yaml";

const HOME = process.env.HOME || os.homedir();
const CREDENTIALS_PATH = path.join(HOME, ".dsh/.credentials.yaml");
const SETTINGS_PATH = path.join(HOME, ".dsh/settings.yaml");

const [targetProvider, newKey, newBaseUrl] = process.argv.slice(2);

if (!targetProvider || !newKey) {
  console.log("Usage: bun ~/.dsh/scripts/set_provider_key.mjs <tabitoken|agentrouter> <API_KEY> [BASE_URL]");
  console.log("Examples:");
  console.log("  bun ~/.dsh/scripts/set_provider_key.mjs tabitoken sk-vGXX... https://tabitoken.com");
  console.log("  bun ~/.dsh/scripts/set_provider_key.mjs agentrouter sk-ewFK... https://agentrouter.org");
  process.exit(0);
}

const providerName = targetProvider.toLowerCase();
if (providerName !== "tabitoken" && providerName !== "agentrouter") {
  console.error("❌ Invalid provider name. Choose 'tabitoken' or 'agentrouter'.");
  process.exit(1);
}

// 1. Update Credentials File
let creds = {};
if (fs.existsSync(CREDENTIALS_PATH)) {
  try {
    creds = yaml.load(fs.readFileSync(CREDENTIALS_PATH, "utf8")) || {};
  } catch (e) {
    console.error("Warning: Failed to read credentials file:", e.message);
  }
}

if (providerName === "tabitoken") {
  creds.TABITOKEN_API_KEY = newKey;
  creds.TABIAI_KEY_1 = newKey;
  creds.NEW_API_KEY = newKey;
  creds.CLAUDE_1_API_KEY = newKey;
  creds.DEEPSEEK_API_KEY = newKey;
  creds.ANTHROPIC_API_KEY = newKey;
  console.log("✅ Updated TaBiToken API key in ~/.dsh/.credentials.yaml");
} else if (providerName === "agentrouter") {
  creds.AGENTROUTER_API_KEY = newKey;
  creds.AGENTROUTER_KEY_1 = newKey;
  creds.AGENT_ROUTER_TOKEN = newKey;
  console.log("✅ Updated AgentRouter API key in ~/.dsh/.credentials.yaml");
}

fs.writeFileSync(CREDENTIALS_PATH, yaml.dump(creds), { mode: 0o600 });

// 2. Optionally Update Base URL
if (newBaseUrl && fs.existsSync(SETTINGS_PATH)) {
  try {
    const settings = yaml.load(fs.readFileSync(SETTINGS_PATH, "utf8")) || {};
    if (settings["llm-pi-ai"]?.providers?.[providerName]) {
      settings["llm-pi-ai"].providers[providerName].baseURL = newBaseUrl.replace(/\/v1\/?$/, "");
    }
    if (providerName === "tabitoken" && settings["llm-deepseek"]) {
      settings["llm-deepseek"].baseURL = `${newBaseUrl.replace(/\/+$/, "")}/v1`;
    }
    fs.writeFileSync(SETTINGS_PATH, yaml.dump(settings), { mode: 0o600 });
    console.log(`✅ Updated ${providerName} baseURL in ~/.dsh/settings.yaml to: ${newBaseUrl}`);
  } catch (e) {
    console.error("Failed to update settings.yaml:", e.message);
  }
}

console.log("✨ Key update complete! You can run smoke tests anytime with:");
console.log("  bun ~/.dsh/scripts/smoke_test_tabitoken.mjs");
