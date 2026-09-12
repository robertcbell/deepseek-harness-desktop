import fs from "node:fs";
import path from "node:path";

export interface GraphNode {
  id: string; // Relative path, e.g. "src/index.ts"
  type: "file";
  functions: string[];
  classes: string[];
  imports: string[];
  exports: string[];
  inDegree: number;
  outDegree: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "imports" | "calls";
}

export interface CodeGraphResult {
  version: string;
  generatedAt: string;
  targetDir: string;
  totalSourceFiles: number;
  totalNodes: number;
  totalEdges: number;
  hubNodes: { file: string; connections: number }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  summaryText: string;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".venv",
  "venv",
  ".turbo",
  ".cache",
  ".planning",
  "coverage",
  "out",
  ".gemini"
]);

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".php", ".rb", ".java", ".sql"
]);

export function walkSourceFiles(dir: string, maxFiles = 1500): string[] {
  let files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        files = files.concat(walkSourceFiles(fullPath, maxFiles));
        if (files.length >= maxFiles) break;
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {}
  return files;
}

export function parseFileSymbols(filePath: string, baseDir: string): GraphNode {
  const relPath = path.relative(baseDir, filePath);
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return {
      id: relPath,
      type: "file",
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      inDegree: 0,
      outDegree: 0,
    };
  }

  // Regex extractors for multi-language symbols
  const functions = [
    ...content.matchAll(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g),
    ...content.matchAll(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g),
    ...content.matchAll(/def\s+([a-zA-Z0-9_]+)\s*\(/g),
    ...content.matchAll(/fn\s+([a-zA-Z0-9_]+)\s*\(/g),
    ...content.matchAll(/func\s+([a-zA-Z0-9_]+)\s*\(/g),
  ].map((m) => m[1]).filter(Boolean).slice(0, 30);

  const classes = [
    ...content.matchAll(/class\s+([a-zA-Z0-9_$]+)/g),
    ...content.matchAll(/struct\s+([a-zA-Z0-9_$]+)/g),
    ...content.matchAll(/interface\s+([a-zA-Z0-9_$]+)/g),
    ...content.matchAll(/type\s+([a-zA-Z0-9_$]+)\s*=/g),
  ].map((m) => m[1]).filter(Boolean).slice(0, 20);

  const imports = [
    ...content.matchAll(/import\s+(?:\{[^}]+\}|\*\s+as\s+[a-zA-Z0-9_$]+|[a-zA-Z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/g),
    ...content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...content.matchAll(/from\s+([a-zA-Z0-9_.]+)\s+import/g),
    ...content.matchAll(/use\s+([a-zA-Z0-9_:]+);/g),
  ].map((m) => m[1]).filter(Boolean).slice(0, 30);

  const exports = [
    ...content.matchAll(/export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface)\s+([a-zA-Z0-9_$]+)/g),
  ].map((m) => m[1]).filter(Boolean).slice(0, 20);

  return {
    id: relPath,
    type: "file",
    functions: Array.from(new Set(functions)),
    classes: Array.from(new Set(classes)),
    imports: Array.from(new Set(imports)),
    exports: Array.from(new Set(exports)),
    inDegree: 0,
    outDegree: imports.length,
  };
}

function normalizeImportPath(im: string): string {
  // Strip extension if .js/.ts/.mjs/.cjs
  return im.replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/, "");
}

export function buildCodeGraph(targetDir: string): CodeGraphResult {
  const allFiles = walkSourceFiles(targetDir);
  const nodesMap = new Map<string, GraphNode>();
  const normalizedKeys = new Map<string, string>(); // stripped -> real key
  const edges: GraphEdge[] = [];

  for (const file of allFiles) {
    const node = parseFileSymbols(file, targetDir);
    nodesMap.set(node.id, node);
    normalizedKeys.set(normalizeImportPath(node.id), node.id);
  }

  // Calculate degrees & map edges
  for (const node of nodesMap.values()) {
    const nodeDir = path.dirname(node.id);
    for (const rawImport of node.imports) {
      if (rawImport.startsWith(".")) {
        const resolvedBase = normalizeImportPath(path.normalize(path.join(nodeDir, rawImport)));
        const matched = normalizedKeys.get(resolvedBase) ||
                        normalizedKeys.get(`${resolvedBase}/index`) ||
                        [...normalizedKeys.keys()].find((k) => k.endsWith(resolvedBase));
        if (matched && nodesMap.has(matched)) {
          edges.push({ from: node.id, to: matched, type: "imports" });
          nodesMap.get(matched)!.inDegree += 1;
        }
      }
    }
  }

  const nodes = Array.from(nodesMap.values());
  const hubNodes = [...nodes]
    .map((n) => ({ file: n.id, connections: n.inDegree + n.outDegree }))
    .sort((a, b) => b.connections - a.connections)
    .slice(0, 10);

  const summaryLines: string[] = [
    `# Codebase Architecture Graph Summary`,
    `Generated at: ${new Date().toISOString()}`,
    `Root: ${targetDir}`,
    `Total Source Files: ${allFiles.length}`,
    `Total Dependencies/Edges: ${edges.length}`,
    ``,
    `## Critical Hub Nodes (Highest Connectivity / Architectural Load):`,
    ...hubNodes.map((h, i) => `${i + 1}. **\`${h.file}\`** (${h.connections} connections: ${nodesMap.get(h.file)?.inDegree || 0} in, ${nodesMap.get(h.file)?.outDegree || 0} out)`),
    ``,
    `## Key Exported Classes & Symbols:`,
    ...nodes
      .filter((n) => n.classes.length > 0 || n.exports.length > 0)
      .slice(0, 15)
      .map((n) => `- **\`${n.id}\`**: ${[...n.classes, ...n.exports].slice(0, 5).join(", ")}`),
  ];

  const summaryText = summaryLines.join("\n");

  const result: CodeGraphResult = {
    version: "2.0.0",
    generatedAt: new Date().toISOString(),
    targetDir,
    totalSourceFiles: allFiles.length,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    hubNodes,
    nodes: nodes.slice(0, 150),
    edges: edges.slice(0, 250),
    summaryText,
  };

  // Persist to .planning/graphs/
  try {
    const graphDir = path.join(targetDir, ".planning", "graphs");
    if (!fs.existsSync(graphDir)) {
      fs.mkdirSync(graphDir, { recursive: true });
    }
    fs.writeFileSync(path.join(graphDir, "code_graph.json"), JSON.stringify(result, null, 2), "utf-8");
    fs.writeFileSync(path.join(graphDir, "ARCHITECTURE_SUMMARY.md"), summaryText, "utf-8");
  } catch {}

  return result;
}

export function queryGraph(query: string, graph: CodeGraphResult): string {
  const q = query.toLowerCase();
  const matchedNodes = graph.nodes.filter(
    (n) =>
      n.id.toLowerCase().includes(q) ||
      n.functions.some((f) => f.toLowerCase().includes(q)) ||
      n.classes.some((c) => c.toLowerCase().includes(q)) ||
      n.exports.some((e) => e.toLowerCase().includes(q))
  );

  if (matchedNodes.length === 0) {
    return `No graph symbols or files found matching "${query}".`;
  }

  const results = matchedNodes.slice(0, 8).map((n) => {
    return `### \`${n.id}\`\n- Classes: ${n.classes.join(", ") || "None"}\n- Functions: ${n.functions.slice(0, 8).join(", ") || "None"}\n- Outbound Imports: ${n.imports.slice(0, 5).join(", ") || "None"}\n- In-degree (Referenced by other files): ${n.inDegree}`;
  });

  return results.join("\n\n");
}

export function calculateBlastRadius(filePath: string, graph: CodeGraphResult): string {
  const normalized = filePath.replace(/^\.?\//, "");
  const callers = graph.edges
    .filter((e) => e.to.includes(normalized) || normalized.includes(e.to))
    .map((e) => e.from);
  
  const dependencies = graph.edges
    .filter((e) => e.from.includes(normalized) || normalized.includes(e.from))
    .map((e) => e.to);

  return [
    `## Blast Radius Analysis for: \`${filePath}\``,
    `Direct Callers/Dependents (Will be affected if interface changes): ${callers.length}`,
    ...Array.from(new Set(callers)).map((c) => `  - ⚠️ \`${c}\``),
    `Downstream Dependencies (What this file relies on): ${dependencies.length}`,
    ...Array.from(new Set(dependencies)).map((d) => `  - 📦 \`${d}\``),
  ].join("\n");
}
