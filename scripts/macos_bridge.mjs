#!/usr/bin/env bun
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const [action, ...args] = process.argv.slice(2);

function notify(title, message, sound = "Glass") {
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" sound name "${sound}"`;
  spawnSync("osascript", ["-e", script]);
  console.log(JSON.stringify({ status: "success", action: "notify", title, message }));
}

function screenshot(outPath = `/tmp/screenshot_${Date.now()}.png`) {
  const resolved = path.resolve(outPath);
  spawnSync("screencapture", ["-x", resolved]);
  console.log(JSON.stringify({ status: "success", action: "screenshot", path: resolved }));
}

function openIn(app, targetPath = ".") {
  const resolved = path.resolve(targetPath);
  if (app === "vscode" || app === "code") {
    spawnSync("code", [resolved]);
  } else if (app === "xcode") {
    spawnSync("open", ["-a", "Xcode", resolved]);
  } else if (app === "finder") {
    spawnSync("open", ["-R", resolved]);
  } else {
    spawnSync("open", [resolved]);
  }
  console.log(JSON.stringify({ status: "success", action: "open", app, path: resolved }));
}

function say(text) {
  spawnSync("say", [text]);
  console.log(JSON.stringify({ status: "success", action: "say", text }));
}

switch (action) {
  case "notify":
    notify(args[0] || "MasterOne", args[1] || "Task completed.", args[2] || "Glass");
    break;
  case "screenshot":
    screenshot(args[0]);
    break;
  case "open":
    openIn(args[0] || "default", args[1] || ".");
    break;
  case "say":
    say(args.join(" ") || "MasterOne task finished");
    break;
  default:
    console.log(JSON.stringify({ error: "Unknown action. Usage: macos_bridge <notify|screenshot|open|say> [args...]" }));
    process.exit(1);
}
