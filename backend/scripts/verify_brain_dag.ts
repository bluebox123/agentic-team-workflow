
import { AGENT_REGISTRY } from "../src/brain/registry";
import { validateWorkflow } from "../src/brain/validator";
import { WorkflowDAG, BrainAnalysisResult } from "../src/brain/types";

// Hardcoded "Mock" LLM response
const MOCK_LLM_RESPONSE = `
\`\`\`json
{
  "canExecute": true,
  "reasonIfCannot": null,
  "workflow": {
    "nodes": [
      {
        "id": "node1",
        "agentType": "scraper",
        "inputs": { "url": "https://example.com" },
        "dependencies": [],
        "outputMapping": {}
      },
      {
        "id": "node2",
        "agentType": "summarizer",
        "inputs": { "max_sentences": 5 },
        "dependencies": ["node1"],
        "outputMapping": { "text": "text" }
      }
    ],
    "edges": [{ "from": "node1", "to": "node2" }],
    "executionOrder": ["node1", "node2"]
  },
  "explanation": "Scrape the URL and then summarize the text."
}
\`\`\`
`;

async function runVerification() {
    console.log("Running Brain Verification (Standalone)...");

    // 1. Verify Registry
    console.log(`Registry loaded with ${AGENT_REGISTRY.length} agents.`);
    if (AGENT_REGISTRY.length === 0) throw new Error("Registry is empty!");

    // 2. Test Validator (Manual DAG construction)
    console.log("Testing Validator...");
    const validDag: WorkflowDAG = {
        nodes: [
            { id: "1", agentType: "scraper", params: { url: "http://test.com" } },
            { id: "2", agentType: "summarizer", params: { max_sentences: 3 } }
        ],
        edges: [{ from: "1", to: "2" }]
    };

    const v1 = validateWorkflow(validDag);
    console.log("Validation Test 1 (Valid):", v1.valid ? "PASS" : "FAIL");
    if (!v1.valid) {
        console.error(v1.errors);
        throw new Error("Valid DAG failed validation");
    }

    const cycleDag: WorkflowDAG = {
        nodes: [
            { id: "1", agentType: "scraper", params: {} },
            { id: "2", agentType: "summarizer", params: {} }
        ],
        edges: [{ from: "1", to: "2" }, { from: "2", to: "1" }]
    };

    const v2 = validateWorkflow(cycleDag);
    console.log("Validation Test 2 (Cycle):", !v2.valid ? "PASS" : "FAIL");
    if (v2.valid) throw new Error("Cycle DAG passed validation");

    // 3. Test Planner Parsing Logic (Simulation)
    console.log("Testing Parsing Logic...");

    let jsonStr = MOCK_LLM_RESPONSE.trim();
    if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
    } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
    }

    const result = JSON.parse(jsonStr) as BrainAnalysisResult;
    console.log("Parsed Result:", result.canExecute);

    if (!result.workflow) throw new Error("Failed to parse workflow");

    const validation = validateWorkflow({
        nodes: result.workflow.nodes.map(n => ({
            id: n.id,
            agentType: n.agentType,
            params: n.inputs
        })),
        edges: result.workflow.edges
    });

    console.log("Parsed Workflow Validation:", validation.valid ? "PASS" : "FAIL");
    if (!validation.valid) throw new Error("Parsed workflow invalid");

    console.log("Verification SUCCESS!");
}

runVerification().catch(err => {
    console.error("Verification command failed:", err);
    process.exit(1);
});
