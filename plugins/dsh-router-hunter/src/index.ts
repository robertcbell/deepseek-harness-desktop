import { createRouterTools } from "./tools.js";
import { GatewayRegistry } from "./registry.js";
import { GatewayProber } from "./prober.js";
import { DshSync } from "./dsh-sync.js";

export const name = "dsh-router-hunter";
export const inject = ["tools"];

export interface CordisContext {
  tools?: {
    register: (tool: any) => void;
  };
  sessionProjections?: {
    register: (definition: any) => void;
  };
  connection?: {
    rpc?: {
      handle: (channel: string, handler: any, options?: any) => () => Promise<void>;
    };
  };
  inject?: (dependencies: string[], callback: (context: any) => void) => void;
  on?: (event: string, listener: (...args: any[]) => void, options?: any) => void;
  emit?: (event: string, ...args: any[]) => void;
  get?: (key: string) => any;
}

export function apply(ctx: CordisContext): void {
  console.log("[dsh-router-hunter] Initializing plugin host runtime...");

  // 1. Register DSH tools
  if (ctx.tools?.register) {
    const tools = createRouterTools();
    for (const tool of tools) {
      try {
        ctx.tools.register(tool);
      } catch (err) {
        console.warn(`[dsh-router-hunter] Failed to register tool ${tool?.name}:`, err);
      }
    }
    console.log(`[dsh-router-hunter] Registered ${tools.length} router management tools.`);
  }

  // 2. Register Session Projection for DSH Web UI
  const registerProjections = (pCtx: any) => {
    const projections = pCtx?.sessionProjections || pCtx?.get?.("sessionProjections");
    if (!projections?.register) return;
    try {
      projections.register({
        key: "routerHunter",
        stateVersion: 1,
        init: () => {
          const gateways = GatewayRegistry.load();
          const totalRemainingUsd = gateways.reduce((acc, g) => acc + (g.credits?.remainingUsd || 0), 0);
          const healthyModels = gateways.flatMap(g => g.models.filter(m => m.status === "HEALTHY"));
          const onlineGateways = gateways.filter(g => g.status === "ONLINE");

          return {
            status: "ACTIVE",
            totalGateways: gateways.length,
            onlineGateways: onlineGateways.length,
            totalRemainingUsd: Math.round(totalRemainingUsd * 100) / 100,
            activeHealthyModelsCount: healthyModels.length,
            gateways: gateways.map(g => ({
              id: g.id,
              name: g.name,
              baseUrl: g.baseUrl,
              status: g.status,
              engine: g.engine,
              remainingUsd: g.credits?.remainingUsd,
              healthyModelsCount: g.models.filter(m => m.status === "HEALTHY").length,
            })),
          };
        },
        apply: (state: any) => state,
      });
      console.log("[dsh-router-hunter] Registered session projection 'routerHunter'");
    } catch (err) {
      console.warn("[dsh-router-hunter] Failed to register session projection:", err);
    }
  };

  if (typeof ctx.inject === "function") {
    ctx.inject(["sessionProjections"], registerProjections);
  } else if ((ctx as any).sessionProjections) {
    registerProjections(ctx);
  }

  // 3. Register RPC Handler for Web UI Settings
  const registerRpc = (cCtx: any) => {
    const rpc = cCtx?.connection?.rpc || cCtx?.rpc;
    if (!rpc || typeof rpc.handle !== "function") return;

    try {
      rpc.handle("/router-hunter", async (endpoint: string, payload: any) => {
        try {
          if (endpoint === "list") {
            const gateways = GatewayRegistry.load();
            return { ok: true, value: { gateways } };
          }

          if (endpoint === "add") {
            if (!payload?.url || !payload?.apiKey) {
              return { ok: false, error: { code: "bad-request", message: "URL and API key required", details: {} } };
            }
            const probeRes = await GatewayProber.probeGateway(payload.url, payload.apiKey, {
              testLongContext: payload.testLongContext ?? true,
            });
            const gateway = {
              id: probeRes.gatewayId,
              name: payload.name || probeRes.statusInfo?.data?.system_name || probeRes.gatewayId,
              baseUrl: probeRes.baseUrl,
              apiKey: payload.apiKey,
              engine: probeRes.engine as any,
              status: (probeRes.online ? "ONLINE" : "WAF_PROTECTED") as any,
              credits: probeRes.credits,
              models: probeRes.models,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            GatewayRegistry.upsert(gateway);
            DshSync.syncGatewaysToDsh(GatewayRegistry.load());
            return { ok: true, value: { gateway, gateways: GatewayRegistry.load() } };
          }

          if (endpoint === "probe") {
            const gw = GatewayRegistry.get(payload.id);
            if (!gw) {
              return { ok: false, error: { code: "not-found", message: "Gateway not found", details: {} } };
            }
            const probeRes = await GatewayProber.probeGateway(gw.baseUrl, gw.apiKey, { testLongContext: true });
            gw.status = probeRes.online ? "ONLINE" : "WAF_PROTECTED";
            gw.credits = probeRes.credits;
            gw.models = probeRes.models;
            gw.updatedAt = new Date().toISOString();
            GatewayRegistry.upsert(gw);
            DshSync.syncGatewaysToDsh(GatewayRegistry.load());
            return { ok: true, value: { gateway: gw, gateways: GatewayRegistry.load() } };
          }

          if (endpoint === "remove") {
            const remaining = GatewayRegistry.remove(payload.id);
            DshSync.syncGatewaysToDsh(remaining);
            return { ok: true, value: { remaining, gateways: remaining } };
          }

          if (endpoint === "sync") {
            const gateways = GatewayRegistry.load();
            const res = DshSync.syncGatewaysToDsh(gateways);
            return { ok: true, value: { ...res, gateways } };
          }

          return { ok: false, error: { code: "not-found", message: `Unknown endpoint ${endpoint}`, details: {} } };
        } catch (err: any) {
          return { ok: false, error: { code: "internal", message: err.message || "Unknown error", details: {} } };
        }
      }, { authority: "loopback" });
    } catch (e) {
      console.warn("[dsh-router-hunter] Failed to register /router-hunter RPC handler:", e);
    }
  };

  if (typeof ctx.inject === "function") {
    ctx.inject(["connection"], registerRpc);
  } else if ((ctx as any).connection) {
    registerRpc(ctx);
  }
}

export * from "./types.js";
export * from "./prober.js";
export * from "./registry.js";
export * from "./dsh-sync.js";
export * from "./tools.js";
