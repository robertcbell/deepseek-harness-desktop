#!/usr/bin/env bun
/**
 * DSH / MasterOne Resilient Multi-Provider Failover Router & Proxy
 * Automatically fails over across providers on 402/403 (quota), 429 (rate limit), or 5xx errors.
 */
import fs from "fs";
import path from "path";
import os from "os";
import * as yaml from "js-yaml";

const HOME = process.env.HOME || os.homedir();
const CREDENTIALS_PATH = path.join(HOME, ".dsh/.credentials.yaml");
const PORT = process.env.PORT || 4099;

function getCredentials() {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      return yaml.load(fs.readFileSync(CREDENTIALS_PATH, "utf8"))?.refs || {};
    } catch (_) {}
  }
  return {};
}

const creds = getCredentials();

const GATEWAYS_PATH = path.join(HOME, ".dsh/gateways.json");

const STATIC_PROVIDERS = [
  {
    id: "agentrouter-1",
    name: "Agentrouter 1",
    url: process.env.AGENTROUTER_1_BASE_URL || "https://agentrouter.org",
    key: creds.AGENTROUTER_1_API_KEY || process.env.AGENTROUTER_1_API_KEY || "",
    priority: 1
  },
  {
    id: "agentrouter-2",
    name: "Agentrouter 2",
    url: process.env.AGENTROUTER_2_BASE_URL || "https://agentrouter.org",
    key: creds.AGENTROUTER_2_API_KEY || process.env.AGENTROUTER_2_API_KEY || "",
    priority: 2
  },
  {
    id: "agentrouter-backup",
    name: "Agentrouter Backup (ps.air-outer.com)",
    url: process.env.AGENTROUTER_BACKUP_BASE_URL || "https://ps.air-outer.com",
    key: creds.AGENTROUTER_1_API_KEY || process.env.AGENTROUTER_1_API_KEY || "",
    priority: 2.5
  },
  {
    id: "tabitoken-1",
    name: "tabitoken 1",
    url: process.env.TABITOKEN_1_BASE_URL || "https://tabitoken.com",
    key: creds.TABITOKEN_1_API_KEY || process.env.TABITOKEN_1_API_KEY || "",
    priority: 3
  },
  {
    id: "tabitoken-2",
    name: "tabitoken 2",
    url: process.env.TABITOKEN_2_BASE_URL || "https://tabitoken.com",
    key: creds.TABITOKEN_2_API_KEY || process.env.TABITOKEN_2_API_KEY || "",
    priority: 4
  },
  {
    id: "tabitoken-3",
    name: "tabitoken 3",
    url: process.env.TABITOKEN_3_BASE_URL || "https://tabitoken.com",
    key: creds.TABITOKEN_3_API_KEY || process.env.TABITOKEN_3_API_KEY || "",
    priority: 5
  }
].filter(p => !!p.key);

export function getProviders() {
  const providers = [...STATIC_PROVIDERS];
  if (fs.existsSync(GATEWAYS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(GATEWAYS_PATH, "utf8"));
      if (Array.isArray(data.gateways)) {
        for (const gw of data.gateways) {
          if (gw.apiKey && gw.baseUrl) {
            // Check if URL and key already present
            const exists = providers.some(p => p.url === gw.baseUrl && p.key === gw.apiKey);
            if (!exists) {
              providers.push({
                id: `dynamic-${gw.id}`,
                name: gw.name || gw.id,
                url: gw.baseUrl,
                key: gw.apiKey,
                priority: gw.status === "ONLINE" ? 1.8 : 6
              });
            }
          }
        }
      }
    } catch (_) {}
  }
  return providers.sort((a, b) => a.priority - b.priority);
}

const cooldowns = new Map();

export function isProviderHealthy(p) {
  const cd = cooldowns.get(p.id);
  if (!cd) return true;
  if (Date.now() > cd) {
    cooldowns.delete(p.id);
    return true;
  }
  return false;
}

export function markExhausted(p, durationMs = 300000) {
  console.warn(`⚠️ [FAILOVER] Provider "${p.name}" marked exhausted (cooldown: ${durationMs / 1000}s)`);
  cooldowns.set(p.id, Date.now() + durationMs);
}

export async function forwardWithFailover(reqPath, method, headers, body) {
  const errors = [];
  const allProviders = getProviders();
  const activeProviders = allProviders.filter(isProviderHealthy);
  const pool = activeProviders.length > 0 ? activeProviders : allProviders;

  for (const provider of pool) {
    try {
      const targetUrl = `${provider.url}${reqPath}`;
      const fwdHeaders = { ...headers };
      delete fwdHeaders["host"];
      delete fwdHeaders["content-length"];

      fwdHeaders["User-Agent"] = "claude-cli/2.1.119 (external, cli)";
      fwdHeaders["user-agent"] = "claude-cli/2.1.119 (external, cli)";
      fwdHeaders["Content-Type"] = "application/json";

      if (reqPath.includes("/messages")) {
        fwdHeaders["anthropic-version"] = "2023-06-01";
        fwdHeaders["x-api-key"] = provider.key;
      } else {
        fwdHeaders["authorization"] = `Bearer ${provider.key}`;
      }

      console.log(`🔄 [ROUTING] Attempting ${provider.name} -> ${targetUrl}`);
      const res = await fetch(targetUrl, {
        method,
        headers: fwdHeaders,
        body: body ? JSON.stringify(body) : undefined
      });

      if (res.status === 402 || res.status === 403 || res.status === 503 || res.status === 429) {
        const errText = await res.text();
        console.warn(`⚠️ [FAILOVER] ${provider.name} returned HTTP ${res.status}: ${errText.substring(0, 120)}`);
        if (res.status === 402 || errText.includes("额度不足") || errText.includes("insufficient") || res.status === 503) {
          markExhausted(provider, 300000);
        }
        errors.push({ provider: provider.name, status: res.status, error: errText });
        continue;
      }

      return res;
    } catch (err) {
      console.error(`❌ [FAILOVER] Network error on ${provider.name}: ${err.message}`);
      errors.push({ provider: provider.name, error: err.message });
    }
  }

  return new Response(JSON.stringify({
    error: {
      message: "All configured providers failed",
      details: errors
    }
  }), { status: 502, headers: { "Content-Type": "application/json" } });
}

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const reqPath = url.pathname + url.search;
      const method = req.method;
      const headers = Object.fromEntries(req.headers.entries());
      let body = null;
      if (method !== "GET" && method !== "HEAD") {
        try {
          body = await req.json();
        } catch (_) {}
      }

      if (url.pathname === "/health") {
        return new Response(JSON.stringify({
          status: "ok",
          providers: getProviders().map(p => ({ id: p.id, name: p.name, healthy: isProviderHealthy(p) }))
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      return forwardWithFailover(reqPath, method, headers, body);
    }
  });
  console.log(`🚀 [DSH FAILOVER PROXY] Listening on http://localhost:${server.port}`);
}
