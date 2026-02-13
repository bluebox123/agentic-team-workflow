import { generateContent } from "./client";
import * as dotenv from "dotenv";

dotenv.config();

async function testPerplexityIntegration() {
    console.log("=== Testing Perplexity API Integration ===\n");

    // Test 1: Direct API Call Check
    console.log("1. Testing 'generateContent' with Perplexity...");
    try {
        const prompt = "Explain sustainable energy in one sentence.";
        console.log(`   Prompt: "${prompt}"`);

        const startTime = Date.now();
        const response = await generateContent(prompt);
        const duration = Date.now() - startTime;

        console.log(`\n✅ Success! (${duration}ms)`);
        console.log(`   Response: ${response}`);

        if (response.length > 5) {
            console.log("   Quality Check: PASSED (Meaningful response received)");
        } else {
            console.log("   Quality Check: WARNING (Response too short)");
        }

    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
    }

    // Test 2: JSON Format Check (Crucial for Planner)
    console.log("\n2. Testing JSON output capability...");
    try {
        const jsonPrompt = `
        You are a workflow planner.
        Return a valid JSON object with a 'plan' field containing the string "Hello World".
        Do not include markdown formatting (backticks).
        `;

        const response = await generateContent(jsonPrompt);
        console.log(`   Response: ${response}`);

        try {
            const parsed = JSON.parse(response);
            console.log("   JSON Parse: SUCCESS");
            console.log("   Value:", parsed);
        } catch (e) {
            console.log("   JSON Parse: FAILED");
            // Check for markdown blocks
            if (response.includes("```")) {
                console.log("   NOTE: Response contains markdown blocks (Planner handles this)");
            }
        }

    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
    }
}

testPerplexityIntegration().catch(console.error);
