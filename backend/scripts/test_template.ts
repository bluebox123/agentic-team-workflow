
import { resolveTaskInputs } from "../src/templateUtils";

// Mock the DB call
jest.mock("../src/db", () => ({
    query: jest.fn().mockResolvedValue({
        rows: [
            {
                id: "task-1",
                name: "scraper_node",
                result: { result: { text: "Scraped content from Google" } }
            },
            {
                id: "task-2",
                name: "other_node",
                result: { result: { count: 42 } }
            }
        ]
    })
}));

async function runTest() {
    console.log("Testing Template Resolution...");

    const jobId = "job-123";
    const taskId = "task-3";
    const parentTaskId = "task-1";

    const payload = {
        "static": "value",
        "dynamic": "{{tasks.scraper_node.outputs.text}}",
        "parent_ref": "{{parent.outputs.text}}",
        "nested": {
            "val": "{{tasks.other_node.outputs.count}}"
        }
    };

    const resolved = await resolveTaskInputs(jobId, taskId, parentTaskId, payload);

    console.log("Resolved Payload:", JSON.stringify(resolved, null, 2));

    if (resolved.dynamic !== "Scraped content from Google") throw new Error("Dynamic resolution failed");
    if (resolved.parent_ref !== "Scraped content from Google") throw new Error("Parent resolution failed");
    if (resolved.nested.val !== "42") throw new Error("Nested resolution failed"); // output is stringified

    console.log("Template Resolution SUCCESS!");
}

// Since we can't easily mock imports in a simple script without jest runner,
// we'll adopt a slight different strategy or just use this file concept if we have jest installed?
// Checking package.json... we don't see 'jest' in dependencies list I recall.
// Let's create a non-mocked version that relies on the function logic being separable if possible.
// `resolveTaskInputs` calls `pool.query`. To test without DB, we should refactor `resolveTaskInputs`
// to take the context as an argument, or use a dependency injection approach.
// BUT for now, let's just create a test that IMPORTS the substitution logic directly if exported?
// It was not exported. Let's export `substitute` from templateUtils.ts.
