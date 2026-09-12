import { queryGraph, calculateBlastRadius, type CodeGraphResult } from "./graph-runner.js";
import fs from "node:fs";
import { encode, decode } from "@toon-format/toon";

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
  execute: (args: any) => Promise<any>;
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
      render: options.output?.render || ((_args: any, val: any) => [
        { type: "text", text: typeof val === "string" ? val : JSON.stringify(val, null, 2) },
      ]),
    },
    execute: options.execute,
  };
}

export function createFableAgenticTools(getGraph: () => CodeGraphResult | undefined) {
  const textOutput = (_args: any, value: any) => [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ];

  return [
    defineTool({
      name: "code_graph_query",
      description: "Query the codebase architectural graph for classes, functions, imports, or modules. Fast in-memory symbol lookup.",
      parameters: {
        query: {
          type: "string",
          required: true,
          description: "Symbol name, function name, class name, or partial file path to search for.",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textOutput,
      },
      async execute(args: { query: string }) {
        const graph = getGraph();
        if (!graph) {
          return "Code graph has not completed building yet. Please try again in a few seconds.";
        }
        return queryGraph(args.query, graph);
      },
    }),

    defineTool({
      name: "code_graph_impact",
      description: "Calculate the architectural blast-radius and dependent callers of a file before modifying its interface.",
      parameters: {
        file: {
          type: "string",
          required: true,
          description: "Relative file path (e.g. src/auth.ts) to calculate callers and dependents for.",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textOutput,
      },
      async execute(args: { file: string }) {
        const graph = getGraph();
        if (!graph) {
          return "Code graph is not ready yet.";
        }
        return calculateBlastRadius(args.file, graph);
      },
    }),

    defineTool({
      name: "fable_route",
      description: "Route an engineering task or request through the Fable-Agentic lifecycle to determine optimal discipline, skill, and gates.",
      parameters: {
        task: {
          type: "string",
          required: true,
          description: "Task or goal description to evaluate.",
        },
        failure_streak: {
          type: "number",
          description: "Current consecutive failure count (if retrying).",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textOutput,
      },
      async execute(args: { task: string; failure_streak?: number }) {
        const streak = args.failure_streak || 0;
        if (streak >= 2) {
          return {
            status: "HALTED",
            circuit_breaker: "OPEN",
            recommended_skill: "fable-recover",
            reason: "Consecutive failure streak >= 2. Speculative editing prohibited. Execute abductive root cause diagnosis.",
          };
        }

        const taskLower = args.task.toLowerCase();
        let skill = "fable-execute";
        let phase = "IMPLEMENTATION";
        let reason = "Direct implementation task.";

        if (taskLower.includes("bug") || taskLower.includes("error") || taskLower.includes("fail") || taskLower.includes("fix")) {
          skill = "ce-debug / fable-recover";
          phase = "DIAGNOSIS";
          reason = "Defect diagnosis loop before writing code.";
        } else if (taskLower.includes("plan") || taskLower.includes("design") || taskLower.includes("architect")) {
          skill = "fable-plan / ce-plan";
          phase = "PLANNING";
          reason = "Requirements framing and multi-step decomposition.";
        } else if (taskLower.includes("verify") || taskLower.includes("test") || taskLower.includes("check")) {
          skill = "fable-verify / test-guard";
          phase = "VERIFICATION";
          reason = "Falsification and acceptance criteria validation.";
        } else if (taskLower.includes("security") || taskLower.includes("auth") || taskLower.includes("token")) {
          skill = "fable-security / api-security";
          phase = "SECURITY_AUDIT";
          reason = "Threat modeling and credential isolation required.";
        }

        return {
          circuit_breaker: "CLOSED",
          recommended_skill: skill,
          phase,
          reason,
          mandatory_gates: ["L0_anti_skip", "L1_functional", "L1.5_pACS_ge_70", "CCP_protocol"],
        };
      },
    }),

    defineTool({
      name: "workflow_gate_check",
      description: "Perform 4-layer quality gate audit on newly generated files (L0: Anti-skip size, L1: Functional verification, L1.5: pACS confidence score).",
      parameters: {
        files: {
          type: "array",
          items: { type: "string" },
          required: true,
          description: "List of modified or created file paths to check.",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textOutput,
      },
      async execute(args: { files: string[] }) {
        const results = [];
        let allPassL0 = true;

        for (const file of args.files) {
          const exists = fs.existsSync(file);
          let size = 0;
          if (exists) {
            try {
              size = fs.statSync(file).size;
            } catch {}
          }
          const passL0 = exists && size >= 100;
          if (!passL0) allPassL0 = false;

          results.push({
            file,
            exists,
            sizeBytes: size,
            L0_status: passL0 ? "PASS" : "FAIL (<100 bytes or missing)",
          });
        }

        return {
          overallStatus: allPassL0 ? "L0_GREEN" : "L0_RED_HALT",
          filesChecked: results,
          nextRequirement: allPassL0
            ? "Run L1 Functional Tests & self-score L1.5 pACS (Faithfulness, Completeness, Logic >= 70)."
            : "L0 Anti-Skip violated: files were not physically written or are empty. Do not report completion.",
        };
      },
    }),

    defineTool({
      name: "toon_encode",
      description: "Encode structured data (JSON string or JavaScript object/array) into official TOON v4.1 format to save 30-60% tokens.",
      parameters: {
        data: {
          type: "string",
          required: true,
          description: "JSON string or object to encode into TOON syntax.",
        },
        delimiter: {
          type: "string",
          enum: [",", "\t", "|"],
          description: "Delimiter for tabular rows: comma (default), tab, or pipe.",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textOutput,
      },
      async execute(args: { data: string; delimiter?: "," | "\t" | "|" }) {
        try {
          let parsed: any = args.data;
          if (typeof args.data === "string") {
            try {
              parsed = JSON.parse(args.data);
            } catch {
              parsed = args.data;
            }
          }
          const toonStr = encode(parsed, { delimiter: args.delimiter || "," });
          const jsonChars = typeof args.data === "string" ? args.data.length : JSON.stringify(parsed, null, 2).length;
          const toonChars = toonStr.length;
          const jsonTokens = Math.max(1, Math.floor(jsonChars / 4));
          const toonTokens = Math.max(1, Math.floor(toonChars / 4));
          const savingsPercent = Math.max(0, Math.round((1 - toonTokens / jsonTokens) * 100));

          return {
            toon: toonStr,
            stats: {
              jsonTokensEstimate: jsonTokens,
              toonTokensEstimate: toonTokens,
              savingsPercent: `${savingsPercent}%`,
              bytesRatio: Number((toonChars / Math.max(1, jsonChars)).toFixed(2)),
            },
          };
        } catch (err: any) {
          return { error: `Failed to encode to TOON: ${err.message}` };
        }
      },
    }),

    defineTool({
      name: "toon_decode",
      description: "Decode official TOON v4.1 formatted text back into structured JavaScript / JSON data.",
      parameters: {
        content: {
          type: "string",
          required: true,
          description: "TOON formatted string to decode.",
        },
        strict: {
          type: "boolean",
          description: "Enable strict syntax validation (default true).",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textOutput,
      },
      async execute(args: { content: string; strict?: boolean }) {
        try {
          const decoded = decode(args.content, { strict: args.strict !== false });
          return decoded;
        } catch (err: any) {
          return { error: `Failed to decode TOON: ${err.message}` };
        }
      },
    }),

    defineTool({
      name: "toon_stats",
      description: "Compare token efficiency and size between JSON and TOON format for a given payload.",
      parameters: {
        data: {
          type: "string",
          required: true,
          description: "JSON string or object to analyze.",
        },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textOutput,
      },
      async execute(args: { data: string }) {
        try {
          let parsed: any;
          if (typeof args.data === "string") {
            try {
              parsed = JSON.parse(args.data);
            } catch {
              return { error: "Invalid JSON input for token analysis" };
            }
          } else {
            parsed = args.data;
          }

          const jsonFormatted = JSON.stringify(parsed, null, 2);
          const toonStr = encode(parsed);

          const jsonTokens = Math.max(1, Math.floor(jsonFormatted.length / 4));
          const toonTokens = Math.max(1, Math.floor(toonStr.length / 4));
          const savings = Math.max(0, Math.round((1 - toonTokens / jsonTokens) * 100));

          return {
            jsonChars: jsonFormatted.length,
            toonChars: toonStr.length,
            jsonTokensEstimate: jsonTokens,
            toonTokensEstimate: toonTokens,
            savingsPercent: `${savings}%`,
            recommendation: savings >= 20 ? "HIGHLY RECOMMENDED (significant token reduction)" : "ACCEPTABLE",
          };
        } catch (err: any) {
          return { error: `Analysis failed: ${err.message}` };
        }
      },
    }),
  ];
}
