import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import type { RouterGateway } from "./types.js";

const DSH_HOME = process.env.DSH_HOME || path.join(process.env.HOME || "", ".dsh");
const SETTINGS_FILE = path.join(DSH_HOME, "settings.yaml");
const CREDENTIALS_FILE = path.join(DSH_HOME, ".credentials.yaml");

export class DshSync {
  static syncGatewaysToDsh(gateways: RouterGateway[]): { success: boolean; updatedProviders: string[] } {
    const updatedProviders: string[] = [];
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { success: false, updatedProviders };
    }

    try {
      const rawSettings = fs.readFileSync(SETTINGS_FILE, "utf8");
      const settings: any = yaml.load(rawSettings) || {};

      if (!settings["llm-pi-ai"]) settings["llm-pi-ai"] = {};
      if (!settings["llm-pi-ai"].providers) settings["llm-pi-ai"].providers = {};

      const credentialsRaw = fs.existsSync(CREDENTIALS_FILE) ? fs.readFileSync(CREDENTIALS_FILE, "utf8") : "";
      const creds: any = yaml.load(credentialsRaw) || { version: 1, refs: {} };
      if (!creds.refs) creds.refs = {};

      for (const gw of gateways) {
        let candidateModels = gw.models && gw.models.length > 0 ? gw.models : [];
        if (candidateModels.length === 0) {
          candidateModels = [
            { id: "claude-opus-5", name: "Claude Opus 5", protocol: "anthropic", contextWindow: 200000, maxTokens: 8192, input: ["text", "image"] },
            { id: "claude-opus-4-8", name: "Claude Opus 4.8", protocol: "anthropic", contextWindow: 200000, maxTokens: 8192, input: ["text", "image"] },
            { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", protocol: "anthropic", contextWindow: 200000, maxTokens: 8192, input: ["text", "image"] },
            { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", protocol: "openai", contextWindow: 128000, maxTokens: 8192, input: ["text"] },
            { id: "glm-5.3", name: "GLM 5.3", protocol: "openai", contextWindow: 128000, maxTokens: 8192, input: ["text"] },
            { id: "gpt-4o", name: "GPT-4o", protocol: "openai", contextWindow: 128000, maxTokens: 8192, input: ["text", "image"] }
          ];
        }

        const envKey = `GATEWAY_${gw.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
        creds.refs[envKey] = gw.apiKey;

        // Auto-populate well-known credential aliases
        if (gw.baseUrl.includes("gorouter")) {
          if (gw.apiKey.startsWith("sk-cofa")) creds.refs["GOROUTER_1_API_KEY"] = gw.apiKey;
          if (gw.apiKey.startsWith("sk-tnYU")) creds.refs["GOROUTER_2_API_KEY"] = gw.apiKey;
        } else if (gw.baseUrl.includes("tabitoken")) {
          if (gw.apiKey.startsWith("sk-N0Ll")) creds.refs["TABITOKEN_1_API_KEY"] = gw.apiKey;
          if (gw.apiKey.startsWith("sk-vGXX")) creds.refs["TABITOKEN_2_API_KEY"] = gw.apiKey;
          if (gw.apiKey.startsWith("sk-ePAD")) creds.refs["TABITOKEN_3_API_KEY"] = gw.apiKey;
        } else if (gw.baseUrl.includes("agentrouter")) {
          if (gw.apiKey.startsWith("sk-ewFK")) creds.refs["AGENTROUTER_1_API_KEY"] = gw.apiKey;
          if (gw.apiKey.startsWith("sk-pHf6")) creds.refs["AGENTROUTER_2_API_KEY"] = gw.apiKey;
        }

        // 1. Anthropic provider if anthropic models exist
        const anthropicModels = candidateModels.filter(m => m.protocol === "anthropic" || m.protocol === "dual" || m.id.includes("claude"));
        if (anthropicModels.length > 0) {
          const providerId = `gateway-${gw.id}-anthropic`;
          settings["llm-pi-ai"].providers[providerId] = {
            displayName: `${gw.name} (Anthropic)`,
            apiKeyEnv: envKey,
            api: "anthropic-messages",
            baseURL: gw.baseUrl,
            headers: {
              "user-agent": "claude-cli/2.1.119 (external, cli)",
              "User-Agent": "claude-cli/2.1.119 (external, cli)",
              "anthropic-version": "2023-06-01"
            },
            defaultMaxTokens: 8192,
            defaultContextWindow: 200000,
            defaultInput: ["text", "image"],
            retryPolicy: { mode: "always", backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } },
            models: anthropicModels.map(m => ({
              id: m.id,
              name: `${m.name || m.id} (${gw.name})`,
              contextWindow: m.contextWindow || 200000,
              maxTokens: m.maxTokens || 8192,
              input: m.input || ["text", "image"],
              reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high", max: "max" }
            }))
          };
          updatedProviders.push(providerId);
        }

        // 2. OpenAI provider if openai models exist
        const openaiModels = candidateModels.filter(m => m.protocol === "openai" || m.protocol === "dual" || !m.id.includes("claude"));
        if (openaiModels.length > 0) {
          const providerId = `gateway-${gw.id}-openai`;
          settings["llm-pi-ai"].providers[providerId] = {
            displayName: `${gw.name} (OpenAI)`,
            apiKeyEnv: envKey,
            api: "openai-completions",
            baseURL: `${gw.baseUrl}/v1`,
            headers: {
              "user-agent": "claude-cli/2.1.119 (external, cli)",
              "User-Agent": "claude-cli/2.1.119 (external, cli)"
            },
            defaultMaxTokens: 128000,
            defaultContextWindow: 200000,
            defaultInput: ["text", "image"],
            retryPolicy: { mode: "always", backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 } },
            models: openaiModels.map(m => ({
              id: m.id,
              name: `${m.name || m.id} (${gw.name})`,
              contextWindow: m.contextWindow || 200000,
              maxTokens: m.maxTokens || 8192,
              input: m.input || ["text"],
              reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high", max: "max" }
            }))
          };
          updatedProviders.push(providerId);
        }
      }

      // Write settings.yaml back
      fs.writeFileSync(SETTINGS_FILE, yaml.dump(settings, { noRefs: true, lineWidth: 120 }), "utf8");

      // Write credentials.yaml back
      fs.writeFileSync(CREDENTIALS_FILE, yaml.dump(creds, { lineWidth: 120 }), "utf8");

      return { success: true, updatedProviders };
    } catch (e) {
      console.error("[dsh-router-hunter] Failed to sync settings.yaml:", e);
      return { success: false, updatedProviders };
    }
  }
}
