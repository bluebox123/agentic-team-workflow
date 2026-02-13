
import { planWorkflow } from "./planner";
import * as client from "./client";

// Mock the generateContent function
// We cast to any to overwrite the readonly export in test context if possible, 
// or fairly assuming we can overwrite it in JS runtime.
// If valid ES module, this might fail. We'll try.
// If it fails, we might need a different approach (e.g. dependency injection pattern in planner.ts, but that requires code change).
// Let's try to overwrite it.

const MOCK_RESPONSES: Record<string, any> = {
    "scrape_summary": {
        "canExecute": true,
        "workflow": {
            "nodes": [
                { "id": "step1", "agentType": "scraper", "inputs": { "url": "http://example.com" }, "dependencies": [] },
                { "id": "step2", "agentType": "summarizer", "inputs": { "text": "{{tasks.step1.outputs.text}}" }, "dependencies": ["step1"] }
            ],
            "edges": [{ "from": "step1", "to": "step2" }]
        }
    },
    "analyze_notify": {
        "canExecute": true,
        "workflow": {
            "nodes": [
                { "id": "step1", "agentType": "executor", "inputs": { "instruction": "Fetch data" }, "dependencies": [] },
                { "id": "step2", "agentType": "analyzer", "inputs": { "data": "{{tasks.step1.outputs.result}}" }, "dependencies": ["step1"] },
                { "id": "step3", "agentType": "notifier", "inputs": { "message": "{{tasks.step2.outputs.insights}}" }, "dependencies": ["step2"] }
            ],
            "edges": [{ "from": "step1", "to": "step2" }, { "from": "step2", "to": "step3" }]
        }
    },
    "invalid_key_test": {
        "canExecute": true,
        "workflow": {
            "nodes": [
                { "id": "node1", "agentType": "scraper", "inputs": { "url": "http://example.com" }, "dependencies": [] },
                { "id": "node2", "agentType": "summarizer", "inputs": { "text": "{{tasks.node1.outputs.text}}" }, "dependencies": ["node1"] },
                { "id": "node3", "agentType": "notifier", "inputs": { "message": "{{tasks.node2.outputs.summarized_content}}" }, "dependencies": ["node2"] }
            ],
            "edges": [{ "from": "node1", "to": "node2" }, { "from": "node2", "to": "node3" }]
        }
    }
};

// Monkey-patch generateContent
// @ts-ignore
client.generateContent = async (prompt: string): Promise<string> => {
    console.log("[TEST] Brain Prompt received:", prompt.substring(0, 50) + "...");

    if (prompt.includes('User Request: "Scrape example.com and summarize it"')) {
        return JSON.stringify(MOCK_RESPONSES["scrape_summary"]);
    }
    if (prompt.includes('User Request: "Fetch data, analyze it, and notify me"')) {
        return JSON.stringify(MOCK_RESPONSES["analyze_notify"]);
    }
    if (prompt.includes('User Request: "Trigger Invalid Key Hallucination"')) {
        return JSON.stringify(MOCK_RESPONSES["invalid_key_test"]);
    }

    return JSON.stringify({ "canExecute": false, "reasonIfCannot": "Unknown prompt" });
};

async function runTests() {
    console.log("=== Starting Brain Integration Tests ===\n");

    // Test 1: Scrape and Summarize
    console.log("Test 1: 'Scrape example.com and summarize it'");
    const result1 = await planWorkflow("Scrape example.com and summarize it");
    if (result1.canExecute && result1.workflow?.nodes.length === 2) {
        console.log("PASS: Generated 2-step workflow");
        // Verify dependency
        if (result1.workflow.nodes[1].inputs.text.includes("tasks.step1")) {
            console.log("PASS: Data dependency correctly linked");
        } else {
            console.error("FAIL: Missing data dependency linkage");
        }
    } else {
        console.error("FAIL: Expected valid 2-step workflow", JSON.stringify(result1, null, 2));
    }

    console.log("\n------------------------------------------------\n");

    // Test 2: Analyze and Notify
    console.log("Test 2: 'Fetch data, analyze it, and notify me'");
    const result2 = await planWorkflow("Fetch data, analyze it, and notify me");
    if (result2.canExecute && result2.workflow?.nodes.length === 3) {
        console.log("PASS: Generated 3-step workflow");
    } else {
        console.error("FAIL: Expected valid 3-step workflow");
    }

    console.log("\n------------------------------------------------\n");

    // Test 3: Invalid Key Validation (Hallucination Check)
    console.log("Test 3: 'Trigger Invalid Key Hallucination'");
    const result3 = await planWorkflow('User Request: "Trigger Invalid Key Hallucination"');
    if (!result3.canExecute && result3.reasonIfCannot?.includes("references non-existent output")) {
        console.log("PASS: Correctly rejected invalid output key 'summarized_content'");
    } else {
        console.error("FAIL: Should have rejected invalid key. Result:", JSON.stringify(result3, null, 2));
    }

    console.log("\n=== specific capability tests ===");
    // Add verification for Chart/Designer if needed
}

runTests().catch(console.error);
