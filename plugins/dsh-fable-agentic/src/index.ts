import { buildCodeGraph, type CodeGraphResult } from "./graph-runner.js";
import { buildCognitiveConstitution } from "./cognitive-governor.js";
import { createFableAgenticTools } from "./tools.js";

export const name = "dsh-fable-agentic";
export const inject = ["tools", "sessionProjections", "agents", "systemPrompt"];

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
  agents?: {
    list: () => any[];
    get: (id: string) => any;
  };
  on?: (event: string, listener: (...args: any[]) => void, options?: any) => void;
  emit?: (event: string, ...args: any[]) => void;
  get?: (key: string) => any;
}

export function apply(ctx: CordisContext): void {
  const workspaceGraphs = new Map<string, CodeGraphResult>();
  const activeSections = new Map<string, () => void>();

  let activeGraph: CodeGraphResult | undefined;

  const getActiveGraph = () => activeGraph;

  // 1. Register DSH tools
  if (ctx.tools?.register) {
    const tools = createFableAgenticTools(getActiveGraph);
    for (const tool of tools) {
      try {
        ctx.tools.register(tool);
      } catch (err) {
        console.warn(`[dsh-fable-agentic] Failed to register tool ${tool?.name}:`, err);
      }
    }
  }

  // 2. Helper to sync code graph for a workspace
  const syncWorkspaceGraph = async (workspacePath: string) => {
    if (!workspacePath || workspacePath === "/" || workspacePath === ".") return;
    try {
      const graph = buildCodeGraph(workspacePath);
      workspaceGraphs.set(workspacePath, graph);
      activeGraph = graph;

      // Update global or agent system prompts
      updateConstitution(graph);
      ctx.emit?.("fable-agentic/graph-updated", { workspace: workspacePath, graph });
    } catch (err) {
      console.warn(`[dsh-fable-agentic] Auto-graph build failed for ${workspacePath}:`, err);
    }
  };

  // 3. Helper to inject/update cognitive constitution
  const updateConstitution = (graph?: CodeGraphResult) => {
    const prompt = ctx.systemPrompt || (typeof ctx.get === "function" ? ctx.get("systemPrompt") : undefined);
    if (!prompt || typeof prompt.section !== "function") return;

    // Clear previous injection if any
    const prevDispose = activeSections.get("global");
    if (prevDispose) {
      try { prevDispose(); } catch {}
    }

    const text = buildCognitiveConstitution(graph);
    try {
      const dispose = prompt.section({
        name: "fable-agentic-constitution",
        order: 30,
        text,
      });
      activeSections.set("global", dispose);
    } catch (err) {
      console.warn("[dsh-fable-agentic] Failed to inject systemPrompt section:", err);
    }
  };

  // Initial prompt injection on startup
  updateConstitution();

  // 4. Hook into session & agent lifecycle events
  if (ctx.on) {
    // Zero-Click auto-trigger whenever a new session starts
    ctx.on("session/created", (session: any) => {
      const cwd = session?.header?.cwd || process.cwd();
      setTimeout(() => {
        syncWorkspaceGraph(cwd);
      }, 50);
    }, { global: true });

    // Whenever an agent is created
    ctx.on("agent/created", (payload: any) => {
      const agent = payload?.agent;
      const cwd = agent?.session?.header?.cwd || process.cwd();
      setTimeout(() => {
        syncWorkspaceGraph(cwd);
      }, 50);
    }, { global: true });

    // Also watch file modifications if emitted
    ctx.on("files/modified", (payload: any) => {
      const cwd = payload?.cwd || process.cwd();
      syncWorkspaceGraph(cwd);
    });
  }

  // 5. Register Session Projections for DSH Web UI
  if (ctx.sessionProjections?.register) {
    try {
      ctx.sessionProjections.register("fableDiscipline", {
        name: "Fable-Agentic Discipline",
        description: "Autonomous code graph and 4-layer quality governance status",
        resolve: () => {
          return {
            status: "ACTIVE",
            graph: activeGraph ? {
              totalFiles: activeGraph.totalSourceFiles,
              totalEdges: activeGraph.totalEdges,
              hubNodes: activeGraph.hubNodes,
              lastSynced: activeGraph.generatedAt,
            } : "PENDING_SCAN",
            circuitBreaker: "CLOSED",
            activeProtocol: "CCP + 4-Layer Quality Stack",
          };
        },
      });
    } catch {}
  }
}

export * from "./graph-runner.js";
export * from "./cognitive-governor.js";
export * from "./tools.js";
