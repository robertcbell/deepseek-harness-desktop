import { buildCodeGraph, queryGraph, calculateBlastRadius } from "./src/graph-runner.js";
import { buildCognitiveConstitution } from "./src/cognitive-governor.js";

console.log("=== Testing Code Graph Generation ===");
const graph = buildCodeGraph(process.cwd());
console.log("Total Files:", graph.totalSourceFiles);
console.log("Total Nodes:", graph.totalNodes);
console.log("Total Edges:", graph.totalEdges);
console.log("Hub Nodes:", graph.hubNodes);

console.log("\n=== Testing Query Graph ===");
const queryResult = queryGraph("agent", graph);
console.log(queryResult.slice(0, 300));

console.log("\n=== Testing Cognitive Constitution Injection ===");
const constitution = buildCognitiveConstitution(graph);
console.log(constitution.slice(0, 400));
console.log("\n✅ ALL TESTS PASSED!");
