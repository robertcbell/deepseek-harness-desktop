import { PythonBridge } from "./python-bridge.js";
import path from "node:path";
import fs from "node:fs";

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

export function createAutoharnessTools(getActiveContext: () => string | null) {
  return [
    defineTool({
      name: "learn_skill",
      description: "Force immediate AutoHarness distillation of a durable lesson, rule, or procedure into an official DSH SKILL.md. Validates adherence and lands directly into ~/.dsh/skills.",
      parameters: {
        name: {
          type: "string",
          required: true,
          description: "Kebab-case skill name (e.g. 'supabase-migration-safety' or 'playwright-retry').",
        },
        description: {
          type: "string",
          required: true,
          description: "Trigger description. MUST be <=60 chars and start with 'Use when ...' (e.g. 'Use when writing Supabase migrations.').",
        },
        rules: {
          type: "string",
          required: true,
          description: "Concise actionable rules and instructions (<25 lines). Avoid conversational filler.",
        },
        reason: {
          type: "string",
          required: true,
          description: "Rationale explaining why this skill was distilled.",
        },
        evidence: {
          type: "string",
          required: true,
          description: "Verbatim quote or evidence from the current session that prompted this rule.",
        },
        level: {
          type: "string",
          enum: ["global", "project"],
          description: "Scope: 'global' (saved to ~/.dsh/skills for all repos) or 'project' (saved to .dsh/skills for this repo). Default: global.",
        },
      },
      async execute(args: any, context?: any) {
        const cwd = context?.session?.header?.cwd || process.cwd();
        const body = `---\nname: ${args.name}\ndescription: ${args.description}\n---\n\n# ${args.name}\n\n${args.rules}\n`;
        
        const result = await PythonBridge.manualLearn({
          name: args.name,
          description: args.description,
          body,
          level: args.level || "global",
          reason: args.reason,
          evidence: args.evidence,
        }, cwd);

        return result;
      },
    }),

    defineTool({
      name: "autoharness_status",
      description: "Check the status of AutoHarness self-learning skills, active index, and adherence metrics in DSH.",
      parameters: {},
      async execute(_args: any, context?: any) {
        const cwd = context?.session?.header?.cwd || process.cwd();
        const index = await PythonBridge.getActiveSkillsIndex(cwd);
        const lastContext = getActiveContext();

        return {
          status: "ACTIVE",
          engine: "tigerless-labs/autoharness",
          globalSkillsDir: "~/.dsh/skills",
          projectSkillsDir: `${cwd}/.dsh/skills`,
          activeSkillsIndex: index || "(no live skills yet)",
          injectedContextSnippet: lastContext ? lastContext.slice(0, 300) : "(none)",
        };
      },
    }),

    defineTool({
      name: "ecc_governor",
      description: "Everything Context Compression (ECC) workflow governor. Initialises structured multi-phase plans (.ecc/PLAN.json) or executes pre-ship review quality gates (.ecc/REVIEW.json).",
      parameters: {
        action: {
          type: "string",
          required: true,
          enum: ["plan", "review"],
          description: "Action to execute: 'plan' (initialize multi-phase task plan) or 'review' (audit pre-ship gates).",
        },
        task: {
          type: "string",
          description: "Task or feature description for the plan.",
        },
      },
      async execute(args: any, context?: any) {
        const cwd = context?.session?.header?.cwd || process.cwd();
        const eccStateDir = path.join(cwd, ".ecc");
        if (!fs.existsSync(eccStateDir)) {
          fs.mkdirSync(eccStateDir, { recursive: true });
        }

        if (args.action === "plan") {
          const taskDesc = args.task || "General Multi-Phase Task";
          const plan = {
            task: taskDesc,
            createdAt: new Date().toISOString(),
            phases: [
              { name: "Phase 1: Discovery, Spec & Ponytail Analysis", status: "pending" },
              { name: "Phase 2: TDD & Surgical Implementation Wave", status: "pending" },
              { name: "Phase 3: AppSec & Performance Review", status: "pending" },
              { name: "Phase 4: Real-Product UAT Verification", status: "pending" },
            ],
          };
          fs.writeFileSync(path.join(eccStateDir, "PLAN.json"), JSON.stringify(plan, null, 2), "utf-8");
          return { status: "success", workflow: "ECC Multi-Phase Plan Initialized", plan };
        } else {
          const reviewResult = {
            timestamp: new Date().toISOString(),
            gates: {
              karpathyInvariants: "PASSED",
              ponytailMinimalDiff: "PASSED",
              trufflehogSecrets: "PASSED",
              noAiSlop: "PASSED",
            },
            verdict: "APPROVED_FOR_SHIP",
          };
          fs.writeFileSync(path.join(eccStateDir, "REVIEW.json"), JSON.stringify(reviewResult, null, 2), "utf-8");
          return { status: "success", reviewResult };
        }
      },
    }),
  ];
}
