#!/usr/bin/env node
/**
 * DeepSeek Harness Portable Invariant Enforcement Engine
 * Guarantees that:
 * 1. @deepseek-ai/dsh-tool-skill supports lazy: true and empty source entries.
 * 2. @deepseek-ai/dsh-tools uses Symbol.for('@deepseek-ai/dsh-tools.scheduler').
 * 3. @deepseek-ai/dsh-client-connection grants instant loopback authentication via session cookie.
 * 4. cordis.patch.yml never references nonexistent packages (e.g. get-fable).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const HOME = process.env.HOME || os.homedir();
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, ".dsh");

// Collect potential node_modules root directories
const nodeModuleRoots = new Set([
  "/opt/homebrew/lib/node_modules",
  "/usr/local/lib/node_modules",
  path.join(HOME, ".bun/install/global/node_modules"),
  path.join(DSH_HOME, "profiles/node_modules"),
  path.join(DSH_HOME, "profiles/web/node_modules")
]);

try {
  const npmRoot = execSync("npm root -g 2>/dev/null", { encoding: "utf8" }).trim();
  if (npmRoot && fs.existsSync(npmRoot)) {
    nodeModuleRoots.add(npmRoot);
  }
} catch {}

const candidateSkillToolFiles = [];
const candidateToolsFiles = [];
const candidateConnectionFiles = [];

for (const root of nodeModuleRoots) {
  // Direct under root
  candidateSkillToolFiles.push(path.join(root, "@deepseek-ai/dsh-tool-skill/lib/index.js"));
  candidateToolsFiles.push(path.join(root, "@deepseek-ai/dsh-tools/lib/index.js"));
  candidateToolsFiles.push(path.join(root, "@deepseek-ai/dsh-tools/lib/types/index.js"));
  candidateConnectionFiles.push(path.join(root, "@deepseek-ai/dsh-client-connection/lib/index.js"));

  // Nested under @deepseek-ai/dsh/node_modules
  candidateSkillToolFiles.push(path.join(root, "@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-skill/lib/index.js"));
  candidateToolsFiles.push(path.join(root, "@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js"));
  candidateToolsFiles.push(path.join(root, "@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/index.js"));
  candidateConnectionFiles.push(path.join(root, "@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js"));
}

let changedCount = 0;

// 1. Enforce Symbol.for in dsh-tools
for (const file of candidateToolsFiles) {
  if (fs.existsSync(file)) {
    try {
      const realPath = fs.realpathSync(file);
      let content = fs.readFileSync(realPath, "utf8");
      if (content.includes('Symbol("@deepseek-ai/dsh-tools.scheduler")') || content.includes("Symbol('@deepseek-ai/dsh-tools.scheduler')")) {
        content = content.replace(
          /Symbol\((["\x27])@deepseek-ai\/dsh-tools\.scheduler\1\)/g,
          "Symbol.for($1@deepseek-ai/dsh-tools.scheduler$1)"
        );
        fs.writeFileSync(realPath, content, "utf8");
        console.log(`[DSH Guard] Enforced Symbol.for in: ${file}`);
        changedCount++;
      }
    } catch (err) {
      console.warn(`[DSH Guard] Warning processing ${file}:`, err.message);
    }
  }
}

// 2. Enforce lazy mode & empty entries in dsh-tool-skill
for (const file of candidateSkillToolFiles) {
  if (fs.existsSync(file)) {
    try {
      const realPath = fs.realpathSync(file);
      let content = fs.readFileSync(realPath, "utf8");
      let modified = false;

      if (!content.includes("lazy: z.boolean()")) {
        content = content.replace(
          /const Config = z\.object\(\{\s*catalogDescriptionMaxLength:[^}]+\}\);/,
          `const Config = z.object({ catalogDescriptionMaxLength: z.number().default(DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH), lazy: z.boolean().default(false), disableCatalogInjection: z.boolean().default(false) });`
        );
        modified = true;
      }

      if (!content.includes("const isLazy = config.lazy === true")) {
        content = content.replace(
          /const catalogDescriptionMaxLength = config\.catalogDescriptionMaxLength \?\? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH;\s*assertPositiveInteger\("catalogDescriptionMaxLength", catalogDescriptionMaxLength, 3\);/,
          `const catalogDescriptionMaxLength = config.catalogDescriptionMaxLength ?? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH;
\tassertPositiveInteger("catalogDescriptionMaxLength", catalogDescriptionMaxLength, 3);
\tconst isLazy = config.lazy === true || config.disableCatalogInjection === true;`
        );
        modified = true;
      }

      if (!content.includes("renderCatalogMessage(entries, isLazy = false)")) {
        content = content.replace(
          "function renderCatalogMessage(entries) {",
          "function renderCatalogMessage(entries, isLazy = false) {"
        );
        content = content.replace(
          "entries\n\t\t}\n\t});\n}",
          "entries: isLazy ? [] : entries\n\t\t}\n\t});\n}"
        );
        modified = true;
      }

      if (!content.includes("if (isLazy) {")) {
        const targetHook = `\tctx.on("agent/pre-step", async ({ agent, signal }, next) => {\n\t\tconst decision = await next();\n\t\tif (decision.kind === "reject") return decision;\n\t\tsignal.throwIfAborted();`;
        const replacementHook = `\tctx.on("agent/pre-step", async ({ agent, signal }, next) => {
\t\tconst decision = await next();
\t\tif (decision.kind === "reject") return decision;
\t\tsignal.throwIfAborted();
\t\tif (isLazy) {
\t\t\tconst history = catalogHistory(agent);
\t\t\tconst existing = catalogMessage(decision.messages);
\t\t\tif (history.published || existing !== void 0) return decision;
\t\t\tconst catalog = renderCatalogMessage([], true);
\t\t\treturn {
\t\t\t\t...decision,
\t\t\t\tmessages: [...decision.messages, catalog]
\t\t\t};
\t\t}`;
        if (content.includes(targetHook)) {
          content = content.replace(targetHook, replacementHook);
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(realPath, content, "utf8");
        console.log(`[DSH Guard] Enforced lazy skill-catalog invariants in: ${file}`);
        changedCount++;
      }
    } catch (err) {
      console.warn(`[DSH Guard] Warning processing ${file}:`, err.message);
    }
  }
}

// 3. Enforce loopback auto-authentication in dsh-client-connection
for (const file of candidateConnectionFiles) {
  if (fs.existsSync(file)) {
    try {
      const realPath = fs.realpathSync(file);
      let content = fs.readFileSync(realPath, "utf8");
      if (!content.includes("isLoopback && (authority === ")) {
        const target = `\t\tif (this.isAuthenticated(req)) return true;\n\t\tthis.writeUnauthorized(req, res);\n\t\treturn false;`;
        const replacement = `\t\tif (this.isAuthenticated(req)) return true;
\t\tconst authority = requestAuthority(req.headers);
\t\tconst remoteIp = req.socket?.remoteAddress;
\t\tconst isLoopback = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
\t\tif (req.method === "GET" && url.pathname === "/" && isLoopback && (authority === "127.0.0.1:3080" || authority === "localhost:3080" || authority?.startsWith("127.0.0.1:") || authority?.startsWith("localhost:"))) {
\t\t\tconst issuedAt = Date.now();
\t\t\tconst expiresAt = issuedAt + this.maxAgeMilliseconds;
\t\t\tconst value = encodeCookie({
\t\t\t\tversion: COOKIE_PAYLOAD_VERSION,
\t\t\t\tauthority,
\t\t\t\tissuedAt,
\t\t\t\texpiresAt
\t\t\t}, this.secret);
\t\t\tres.writeHead(303, {
\t\t\t\t"cache-control": "no-store",
\t\t\t\t"location": "/",
\t\t\t\t"referrer-policy": "no-referrer",
\t\t\t\t"set-cookie": sessionCookie(cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1e3))
\t\t\t});
\t\t\tres.end();
\t\t\treturn false;
\t\t}
\t\tthis.writeUnauthorized(req, res);
\t\treturn false;`;
        if (content.includes(target)) {
          content = content.replace(target, replacement);
          fs.writeFileSync(realPath, content, "utf8");
          console.log(`[DSH Guard] Enforced loopback auto-auth in: ${file}`);
          changedCount++;
        }
      }
    } catch (err) {
      console.warn(`[DSH Guard] Warning processing ${file}:`, err.message);
    }
  }
}

// 4. Ensure cordis.patch.yml never has invalid get-fable entry
const patchFiles = [
  path.join(DSH_HOME, "cordis.patch.yml"),
  path.join(DSH_HOME, "profiles/web/cordis.patch.yml")
];
for (const pf of patchFiles) {
  if (fs.existsSync(pf)) {
    try {
      let pContent = fs.readFileSync(pf, "utf8");
      const hasFableInstalled = fs.existsSync(path.join(DSH_HOME, "profiles/web/node_modules/get-fable")) ||
                                fs.existsSync(path.join(DSH_HOME, "plugins/get-fable"));
      if (pContent.includes("get-fable") && !hasFableInstalled) {
        pContent = pContent.split("\n").filter(line => !line.includes("get-fable")).join("\n");
        fs.writeFileSync(pf, pContent, "utf8");
        console.log(`[DSH Guard] Cleaned invalid get-fable from: ${pf}`);
        changedCount++;
      }
    } catch (err) {
      console.warn(`[DSH Guard] Warning processing ${pf}:`, err.message);
    }
  }
}

console.log(`[DSH Guard] Invariant check complete. Updates applied: ${changedCount}`);
