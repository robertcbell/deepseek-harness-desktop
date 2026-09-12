import { PythonBridge } from "./python-bridge.js";
import { createAutoharnessTools } from "./tools.js";

export const name = "dsh-autoharness";
export const inject = ["tools", "sessionProjections", "systemPrompt"];

export interface CordisContext {
  tools?: {
    register: (tool: any) => void;
  };
  sessionProjections?: {
    register: (name: string, definition: any) => void;
  };
  systemPrompt?: {
    section: (opts: { name: string; order: number; text: string }) => () => void;
  };
  on?: (event: string, listener: (...args: any[]) => void, options?: any) => void;
  emit?: (event: string, ...args: any[]) => void;
  get?: (key: string) => any;
}

export function apply(ctx: CordisContext): void {
  let activeContext: string | null = null;
  const activeSections = new Map<string, () => void>();

  const getActiveContext = () => activeContext;

  // 1. Register DSH tools
  if (ctx.tools?.register) {
    const tools = createAutoharnessTools(getActiveContext);
    for (const tool of tools) {
      try {
        ctx.tools.register(tool);
      } catch (err) {
        console.warn(`[dsh-autoharness] Failed to register tool ${tool?.name}:`, err);
      }
    }
  }

  // 2. Helper to inject/update system prompt with autoharness index
  const updateSystemPrompt = (contextText: string | null) => {
    const prompt = ctx.systemPrompt || (typeof ctx.get === "function" ? ctx.get("systemPrompt") : undefined);
    if (!prompt || typeof prompt.section !== "function") return;

    // Clear previous injection if any
    const prevDispose = activeSections.get("global");
    if (prevDispose) {
      try { prevDispose(); } catch {}
    }

    if (!contextText || !contextText.trim()) return;

    try {
      const dispose = prompt.section({
        name: "autoharness-skills-index",
        order: 25,
        text: contextText,
      });
      activeSections.set("global", dispose);
    } catch (err) {
      console.warn("[dsh-autoharness] Failed to inject systemPrompt section:", err);
    }
  };

  // 3. Helper to trigger session startup pass
  const onSessionStart = async (sessionId: string, cwd: string) => {
    try {
      const res = await PythonBridge.onSessionStart(sessionId, cwd);
      if (res?.context) {
        activeContext = res.context;
        updateSystemPrompt(res.context);
      }
    } catch (err) {
      console.warn("[dsh-autoharness] Error during onSessionStart:", err);
    }
  };

  // 4. Hook into session & agent lifecycle events
  if (ctx.on) {
    // When a session is created
    ctx.on("session/created", (session: any) => {
      const sessionId = session?.id || `session-${Date.now()}`;
      const cwd = session?.header?.cwd || process.cwd();
      setTimeout(() => {
        onSessionStart(sessionId, cwd);
      }, 50);
    }, { global: true });

    // When an agent is created
    ctx.on("agent/created", (payload: any) => {
      const agent = payload?.agent;
      const sessionId = agent?.session?.id || `agent-${Date.now()}`;
      const cwd = agent?.session?.header?.cwd || process.cwd();
      setTimeout(() => {
        onSessionStart(sessionId, cwd);
      }, 50);
    }, { global: true });

    // When a tool is called
    ctx.on("tool/call", (payload: any) => {
      const toolName = payload?.name || payload?.toolName;
      const sessionId = payload?.sessionId || "default";
      const cwd = payload?.cwd || process.cwd();
      PythonBridge.onPreToolUse(sessionId, toolName, payload?.arguments, cwd).catch(() => {});
    });

    // When a turn ends / stops
    ctx.on("turn/completed", (payload: any) => {
      const sessionId = payload?.sessionId || "default";
      const cwd = payload?.cwd || process.cwd();
      PythonBridge.onStop(sessionId, cwd).catch(() => {});
    });

    // When session ends / flushes
    ctx.on("session/ended", (payload: any) => {
      const sessionId = payload?.sessionId || "default";
      const cwd = payload?.cwd || process.cwd();
      PythonBridge.onSessionEnd(sessionId, cwd).catch(() => {});
    });
  }

  // 5. Register Session Projection for DSH Web UI
  if (ctx.sessionProjections?.register) {
    try {
      ctx.sessionProjections.register("autoharness", {
        name: "AutoHarness Self-Learning",
        description: "Autonomous skill layer learning, index surfacing, and adherence monitoring",
        resolve: () => {
          return {
            status: "ACTIVE",
            engine: "tigerless-labs/autoharness",
            globalSkillsDir: "~/.dsh/skills",
            hasActiveIndex: Boolean(activeContext),
          };
        },
      });
    } catch {}
  }
}

export * from "./python-bridge.js";
export * from "./tools.js";
