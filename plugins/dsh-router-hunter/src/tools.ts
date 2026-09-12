import { GatewayProber } from "./prober.js";
import { GatewayRegistry } from "./registry.js";
import { DshSync } from "./dsh-sync.js";
import type { RouterGateway } from "./types.js";

export interface ToolParameterSpec {
  type: string;
  required?: boolean;
  description?: string;
  enum?: string[];
  items?: any;
}

export interface ToolOptions {
  name: string;
  description: string;
  parameters: Record<string, ToolParameterSpec>;
  output?: {
    schema?: any;
    render?: (args: any, value: any) => any[];
  };
  execute: (args: any, context?: any) => Promise<any>;
}

export function defineTool(options: ToolOptions) {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, spec] of Object.entries(options.parameters || {})) {
    properties[key] = {
      type: spec.type,
      description: spec.description || "",
      ...(spec.enum ? { enum: spec.enum } : {}),
      ...(spec.items ? { items: spec.items } : {}),
    };
    if (spec.required) {
      required.push(key);
    }
  }

  const textOutput = (_args: any, val: any) => [
    { type: "text", text: typeof val === "string" ? val : JSON.stringify(val, null, 2) },
  ];

  return {
    name: options.name,
    description: options.description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    output: {
      schema: options.output?.schema || { type: "object", additionalProperties: true },
      render: options.output?.render || textOutput,
    },
    execute: options.execute,
  };
}

export function createRouterTools() {
  const routerAdd = defineTool({
    name: "router_add",
    description: "Discover, probe, benchmark and register a new AI Gateway / New-API platform (e.g. GoRouter, OrcaRouter, TabiToken, AgentRouter) into DSH with remaining credit detection.",
    parameters: {
      url: { type: "string", required: true, description: "Base URL of the gateway (e.g. https://gorouter.app or https://agentrouter.org)" },
      apiKey: { type: "string", required: true, description: "API Key (starting with sk-...)" },
      name: { type: "string", required: false, description: "Display name for the gateway (optional, auto-detected from host)" },
      testLongContext: { type: "boolean", required: false, description: "Test for silent failure on long context (>400 words). Default: true" },
    },
    execute: async (args: { url: string; apiKey: string; name?: string; testLongContext?: boolean }) => {
      const probeRes = await GatewayProber.probeGateway(args.url, args.apiKey, {
        testLongContext: args.testLongContext ?? true,
      });

      const gateway: RouterGateway = {
        id: probeRes.gatewayId,
        name: args.name || probeRes.statusInfo?.data?.system_name || probeRes.gatewayId,
        baseUrl: probeRes.baseUrl,
        apiKey: args.apiKey,
        engine: probeRes.engine as any,
        status: probeRes.online ? "ONLINE" : "WAF_PROTECTED",
        credits: probeRes.credits,
        models: probeRes.models,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      GatewayRegistry.upsert(gateway);
      const syncRes = DshSync.syncGatewaysToDsh(GatewayRegistry.load());

      return {
        success: true,
        gateway: {
          id: gateway.id,
          name: gateway.name,
          status: gateway.status,
          engine: gateway.engine,
          credits: gateway.credits,
          modelsCount: gateway.models.length,
          healthyModels: gateway.models.filter(m => m.status === "HEALTHY").map(m => m.id),
          silentFailureModels: gateway.models.filter(m => m.status === "SILENT_FAILURE_LONG_CONTEXT").map(m => m.id),
          dshSyncedProviders: syncRes.updatedProviders,
        },
        privacyNotice: "⚠️ Note: Avoid transmitting confidential company secrets or production credentials through public third-party gateways."
      };
    },
  });

  const routerList = defineTool({
    name: "router_list",
    description: "List all registered AI gateways, credit balances, model statuses, latencies, and health indicators.",
    parameters: {
      healthyOnly: { type: "boolean", required: false, description: "Show only gateways with healthy models" }
    },
    execute: async (args: { healthyOnly?: boolean }) => {
      const list = GatewayRegistry.load();
      const filtered = args.healthyOnly ? list.filter(g => g.status === "ONLINE") : list;

      return {
        count: filtered.length,
        gateways: filtered.map(g => ({
          id: g.id,
          name: g.name,
          url: g.baseUrl,
          status: g.status,
          credits: g.credits,
          models: g.models.map(m => ({ id: m.id, status: m.status, latencyMs: m.latencyMs, notes: m.notes })),
        }))
      };
    },
  });

  const routerProbe = defineTool({
    name: "router_probe",
    description: "Execute deep multi-tier benchmarking on a registered gateway to measure response latency and detect long-context silent failures.",
    parameters: {
      gatewayId: { type: "string", required: true, description: "ID or URL of the gateway to probe" },
      testLongContext: { type: "boolean", required: false, description: "Run 450-word long context silent failure test" }
    },
    execute: async (args: { gatewayId: string; testLongContext?: boolean }) => {
      const gw = GatewayRegistry.get(args.gatewayId);
      if (!gw) return { success: false, error: `Gateway '${args.gatewayId}' not found in registry.` };

      const probeRes = await GatewayProber.probeGateway(gw.baseUrl, gw.apiKey, {
        testLongContext: args.testLongContext ?? true
      });

      gw.status = probeRes.online ? "ONLINE" : "WAF_PROTECTED";
      gw.credits = probeRes.credits;
      gw.models = probeRes.models;
      GatewayRegistry.upsert(gw);
      DshSync.syncGatewaysToDsh(GatewayRegistry.load());

      return {
        success: true,
        gatewayId: gw.id,
        status: gw.status,
        credits: gw.credits,
        models: gw.models.map(m => ({ id: m.id, status: m.status, latencyMs: m.latencyMs, notes: m.notes }))
      };
    },
  });

  const routerSync = defineTool({
    name: "router_sync",
    description: "Synchronize all registered gateways into DSH configuration (settings.yaml and failover proxy).",
    parameters: {},
    execute: async () => {
      const gateways = GatewayRegistry.load();
      const res = DshSync.syncGatewaysToDsh(gateways);
      return {
        success: res.success,
        syncedGatewaysCount: gateways.length,
        updatedProviders: res.updatedProviders
      };
    }
  });

  const routerRemove = defineTool({
    name: "router_remove",
    description: "Remove a registered AI gateway from registry and DSH configuration.",
    parameters: {
      gatewayId: { type: "string", required: true, description: "ID or URL of the gateway to remove" }
    },
    execute: async (args: { gatewayId: string }) => {
      const remaining = GatewayRegistry.remove(args.gatewayId);
      const res = DshSync.syncGatewaysToDsh(remaining);
      return {
        success: true,
        removed: args.gatewayId,
        remainingCount: remaining.length,
        updatedProviders: res.updatedProviders
      };
    }
  });

  return [routerAdd, routerList, routerProbe, routerSync, routerRemove];
}
