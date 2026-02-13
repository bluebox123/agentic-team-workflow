
import { planWorkflow } from "../src/brain/planner";
import { AGENT_REGISTRY } from "../src/brain/registry";

// Mock the generateContent to avoid real API calls and ensure deterministic tests
jest.mock("../src/brain/client", () => ({
    generateContent: jest.fn((prompt: string) => {
        if (prompt.includes("coffee")) {
            return Promise.resolve(JSON.stringify({
                canExecute: false,
                reasonIfCannot: "No coffee machine agent available."
            }));
        }
        if (prompt.includes("scrape")) {
            return Promise.resolve(JSON.stringify({
                canExecute: true,
                workflow: {
                    nodes: [
                        { id: "1", agentType: "scraper", inputs: { url: "http://test.com" }, dependencies: [] },
                        { id: "2", agentType: "summarizer", inputs: { text: "{{tasks.1.outputs.text}}" }, dependencies: ["1"] }
                    ],
                    edges: [{ from: "1", to: "2" }],
                    executionOrder: ["1", "2"]
                },
                explanation: "Scrape and summarize."
            }));
        }
        return Promise.resolve(JSON.stringify({ canExecute: false, reasonIfCannot: "Unknown request" }));
    })
}));

async function runTests() {
    console.log("Starting Phase 4 Verification...");

    // Test 1: Valid Request
    console.log("Test 1: Valid Request (Scrape & Summarize)");
    const result1 = await planWorkflow("Scrape google.com and summarize it");
    if (!result1.canExecute) throw new Error("Test 1 Failed: Should be executable");
    if (result1.workflow?.nodes.length !== 2) throw new Error("Test 1 Failed: Should have 2 nodes");
    // Check for placeholder
    const input = result1.workflow.nodes[1].inputs.text;
    if (input !== "{{tasks.1.outputs.text}}") throw new Error(`Test 1 Failed: Invalid placeholder formatting. Got: ${input}`);
    console.log("PASS: Valid Request verified.");

    // Test 2: Invalid Request (Out of Scope)
    console.log("Test 2: Invalid Request (Make coffee)");
    const result2 = await planWorkflow("Make me a cup of coffee");
    if (result2.canExecute) throw new Error("Test 2 Failed: Should NOT be executable");
    if (!result2.reasonIfCannot?.includes("coffee")) throw new Error("Test 2 Failed: Wrong rejection reason");
    console.log("PASS: Out-of-scope request rejected.");

    // Test 3: Registry Check
    console.log("Test 3: Registry Integrity");
    const scraper = AGENT_REGISTRY.find(a => a.id === "scraper");
    if (!scraper) throw new Error("Test 3 Failed: Scraper agent missing in registry");
    console.log("PASS: Registry integrity verified.");

    console.log("ALL TESTS PASSED.");
}

// Simple execution wrapper since we can't easily use jest CLI here
// We need to implement the mock manually if not using jest environment
// Let's rewrite the mock part to standard JS/TS override if possible or use a mocking library if available.
// Since 'jest' is not available in standard node execution, I'll create a manual mock wrapper.
