import { PythonBridge } from "./src/python-bridge.js";

async function main() {
  console.log("1. Testing PythonBridge onSessionStart...");
  const startRes = await PythonBridge.onSessionStart("test-sess-1", process.cwd());
  console.log("Start result:", startRes);

  console.log("\n2. Testing manualLearn with valid AutoHarness format...");
  const desc = "Use when probing AutoHarness integration with DSH.";
  const body = `---
name: autoharness-probe
description: ${desc}
---

# autoharness-probe
1. Always ensure PythonBridge communicates cleanly with DSH.
2. Confirm skills land in ~/.dsh/skills.
`;

  const learnRes = await PythonBridge.manualLearn({
    name: "autoharness-probe",
    description: desc,
    body,
    reason: "Unit test probe",
    evidence: "User requested automated integration in all sessions",
    level: "global"
  }, process.cwd());
  console.log("Learn result:", learnRes);

  console.log("\n3. Testing getActiveSkillsIndex...");
  const index = await PythonBridge.getActiveSkillsIndex(process.cwd());
  console.log("Active skills index:\n", index);

  console.log("\n4. Testing SessionStart after skill landed...");
  const startRes2 = await PythonBridge.onSessionStart("test-sess-2", process.cwd());
  console.log("Start result 2 context:\n", startRes2?.context);

  if (learnRes.ok && index.includes("autoharness-probe") && startRes2?.context?.includes("autoharness-probe")) {
    console.log("\n✅ SUCCESS: All tests passed! AutoHarness skill learned, indexed, and surfaced into session context!");
  } else {
    console.error("\n❌ FAILURE: Checks did not pass.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
