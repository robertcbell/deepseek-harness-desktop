#!/usr/bin/env bun
import fs from "fs";
import path from "path";
import os from "os";

const homedir = process.env.HOME || os.homedir();
const cordisPath = path.join(homedir, ".dsh/.agent-presets/masterone/agent.cordis.yml");
const claudeConfigPath = path.join(homedir, "Library/Application Support/Claude/claude_desktop_config.json");
const cursorConfigPath = path.join(homedir, ".cursor/mcp.json");

const [action, ...args] = process.argv.slice(2);

// Disallow interactive or broken remote servers that open browser tabs / hang startup
const BLOCKED_SERVERS = ["cloudflare", "render", "mcp-remote"];

function isBlocked(serverName, cfg) {
  const name = serverName.toLowerCase();
  if (BLOCKED_SERVERS.some(b => name.includes(b))) return true;
  if (cfg.command && cfg.command.includes("mcp-remote")) return true;
  if (cfg.args && cfg.args.some(a => typeof a === "string" && (a.includes("mcp-remote") || a.includes("cloudflare")))) return true;
  if (cfg.url && (cfg.url.includes("cloudflare") || cfg.url.includes("mcp.render.com"))) return true;
  return false;
}

function cleanCordis() {
  if (!fs.existsSync(cordisPath)) return;
  let content = fs.readFileSync(cordisPath, "utf-8");
  // Remove any - id: mcp-cloudflare... or mcp-render blocks
  const cleaned = content.replace(/\n\s*-\s*id:\s*mcp-(?:cloudflare|render)[^\n]*\n(?:\s+[^\n]+\n)*/gi, "\n");
  if (cleaned !== content) {
    fs.writeFileSync(cordisPath, cleaned, "utf-8");
  }
}

function getInstalledServers() {
  if (!fs.existsSync(cordisPath)) return [];
  const content = fs.readFileSync(cordisPath, "utf-8");
  const regex = /- id: (mcp-[a-zA-Z0-9_-]+)\s*\n\s*name:\s*['"]?@deepseek-ai\/dsh-mcp-client['"]?\s*\n\s*config:\s*\n\s*serverName:\s*([^\n]+)/g;
  const servers = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    servers.push({ id: match[1], serverName: match[2].trim() });
  }
  return servers;
}

function importExternalConfigs() {
  cleanCordis();
  let imported = 0;
  const sources = [
    { name: "Claude Desktop", path: claudeConfigPath },
    { name: "Cursor", path: cursorConfigPath }
  ];

  let cordisContent = fs.readFileSync(cordisPath, "utf-8");

  for (const src of sources) {
    if (!fs.existsSync(src.path)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(src.path, "utf-8"));
      const mcpServers = parsed.mcpServers || {};
      for (const [serverName, cfg] of Object.entries(mcpServers)) {
        if (isBlocked(serverName, cfg)) continue;

        const id = `mcp-${serverName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
        if (cordisContent.includes(`id: ${id}`)) continue;

        let block = "";
        if (cfg.url) {
          block = `
- id: ${id}
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: ${serverName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32)}
    transport: streamable-http
    url: "${cfg.url}"
    failOnStartupError: false
`;
          if (cfg.headers) {
            block += `    headers:\n`;
            for (const [hk, hv] of Object.entries(cfg.headers)) {
              block += `      ${hk}: "${hv}"\n`;
            }
          }
        } else if (cfg.command) {
          const argsArr = (cfg.args || []).map(a => `"${a}"`).join(", ");
          block = `
- id: ${id}
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: ${serverName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32)}
    transport: stdio
    command: "${cfg.command}"
    args: [${argsArr}]
    failOnStartupError: false
`;
          if (cfg.env) {
            block += `    env:\n`;
            for (const [ek, ev] of Object.entries(cfg.env)) {
              block += `      ${ek}: "${ev}"\n`;
            }
          }
        }

        if (block) {
          cordisContent += block;
          imported++;
        }
      }
    } catch (e) {
      // ignore parsing errors
    }
  }

  if (imported > 0) {
    fs.writeFileSync(cordisPath, cordisContent, "utf-8");
  }
  return { status: "success", importedCount: imported };
}

switch (action) {
  case "list":
    console.log(JSON.stringify({ status: "success", servers: getInstalledServers() }));
    break;
  case "clean":
    cleanCordis();
    console.log(JSON.stringify({ status: "success", message: "Cleaned blocked MCPs" }));
    break;
  case "sync":
  case "import":
    console.log(JSON.stringify(importExternalConfigs()));
    break;
  default:
    console.log(JSON.stringify({ usage: "mcp_hub <list|sync|import|clean>" }));
}
