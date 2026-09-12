import { spawn } from "node:child_process";
import path from "node:path";

const VENDOR_AUTOHARNESS_SRC = path.join(process.env.HOME || "", ".dsh/vendor/autoharness/src");
const GLOBAL_DSH_ROOT = path.join(process.env.HOME || "", ".dsh");

export interface AutoharnessSessionStartResult {
  archived: { global: string[]; project: string[] };
  context: string | null;
}

export class PythonBridge {
  private static getEnv(cwd: string): NodeJS.ProcessEnv {
    const projectRoot = path.join(cwd, ".dsh");
    return {
      ...process.env,
      PYTHONPATH: VENDOR_AUTOHARNESS_SRC,
      AUTOHARNESS_GLOBAL_ROOT: GLOBAL_DSH_ROOT,
      AUTOHARNESS_PROJECT_ROOT: projectRoot,
      AUTOHARNESS_RUNNER: "dsh",
    };
  }

  static async dispatch(event: Record<string, any>, cwd: string = process.cwd()): Promise<any> {
    return new Promise((resolve) => {
      const code = "import sys, json; from autoharness.hook import dispatch; print(json.dumps(dispatch.dispatch(json.load(sys.stdin))))";
      const py = spawn("python3", ["-c", code], {
        env: this.getEnv(cwd),
        cwd,
      });

      let stdout = "";
      let stderr = "";

      py.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      py.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      py.on("close", (code) => {
        if (code !== 0) {
          console.warn(`[dsh-autoharness] python dispatch exited with code ${code}: ${stderr}`);
          return resolve(null);
        }
        try {
          const trimmed = stdout.trim();
          resolve(JSON.parse(trimmed));
        } catch (err) {
          console.warn("[dsh-autoharness] Failed to parse dispatch output:", stdout, err);
          resolve(null);
        }
      });

      py.stdin.write(JSON.stringify(event));
      py.stdin.end();
    });
  }

  static async onSessionStart(sessionId: string, cwd: string): Promise<AutoharnessSessionStartResult | null> {
    const res = await this.dispatch({
      hook_event_name: "SessionStart",
      session_id: sessionId,
    }, cwd);
    return res?.result || null;
  }

  static async onPreToolUse(sessionId: string, toolName: string, toolInput: any, cwd: string): Promise<any> {
    const res = await this.dispatch({
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: toolName,
      tool_input: toolInput,
    }, cwd);
    return res?.result || null;
  }

  static async onStop(sessionId: string, cwd: string): Promise<any> {
    const res = await this.dispatch({
      hook_event_name: "Stop",
      session_id: sessionId,
    }, cwd);
    return res?.result || null;
  }

  static async onSessionEnd(sessionId: string, cwd: string): Promise<any> {
    const res = await this.dispatch({
      hook_event_name: "SessionEnd",
      session_id: sessionId,
    }, cwd);
    return res?.result || null;
  }

  static async getActiveSkillsIndex(cwd: string): Promise<string> {
    return new Promise((resolve) => {
      const code = `
from autoharness.hook import spawn
from autoharness.lib import layer
from pathlib import Path
import os

roots = {
    layer.GLOBAL: Path(os.environ.get("AUTOHARNESS_GLOBAL_ROOT", Path.home() / ".dsh")),
    layer.PROJECT: Path(os.environ.get("AUTOHARNESS_PROJECT_ROOT", Path.cwd() / ".dsh")),
}
print(spawn.description_index(roots))
`;
      const py = spawn("python3", ["-c", code], {
        env: this.getEnv(cwd),
        cwd,
      });

      let stdout = "";
      py.stdout.on("data", (d) => { stdout += d.toString(); });
      py.on("close", () => {
        resolve(stdout.trim());
      });
    });
  }

  static async manualLearn(params: {
    name: string;
    description: string;
    body: string;
    level?: "global" | "project";
    reason: string;
    evidence: string;
  }, cwd: string): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const script = `
import json
import sys
from autoharness.stage_skill import server
from autoharness.hook import promoter
from autoharness.lib import layer
from pathlib import Path
import os

data = json.loads(sys.stdin.read())
proot = Path(os.environ.get("AUTOHARNESS_PROJECT_ROOT", Path.cwd() / ".dsh"))
groot = Path(os.environ.get("AUTOHARNESS_GLOBAL_ROOT", Path.home() / ".dsh"))
roots = {layer.PROJECT: proot, layer.GLOBAL: groot}

run_id = "interactive"
stage_res = server.stage({
    "action": "create",
    "name": data["name"],
    "level": data.get("level", "global"),
    "body": data["body"],
    "reason": data["reason"],
    "evidence": data["evidence"],
}, run_id=run_id, root=proot)

if not stage_res.get("ok"):
    print(json.dumps({"ok": False, "errors": stage_res.get("errors")}))
    sys.exit(0)

drain_res = promoter.drain(run_id, roots=roots)
print(json.dumps({"ok": True, "drain": drain_res}))
`;
      const py = spawn("python3", ["-c", script], {
        env: this.getEnv(cwd),
        cwd,
      });

      let stdout = "";
      let stderr = "";
      py.stdout.on("data", (d) => { stdout += d.toString(); });
      py.stderr.on("data", (d) => { stderr += d.toString(); });
      py.on("close", (code) => {
        try {
          const res = JSON.parse(stdout.trim());
          if (res.ok) {
            resolve({ ok: true, message: `Skill '${params.name}' successfully distilled and landed in ~/.dsh/skills!` });
          } else {
            resolve({ ok: false, message: `Validation errors: ${JSON.stringify(res.errors)}` });
          }
        } catch {
          resolve({ ok: false, message: stderr || stdout || "Unknown error during learn." });
        }
      });

      py.stdin.write(JSON.stringify(params));
      py.stdin.end();
    });
  }
}
