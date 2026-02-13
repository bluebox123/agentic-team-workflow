import { planWorkflow } from "./planner";

const TEST_PROMPTS = [
    // === SIMPLE SINGLE-AGENT TASKS ===
    "Scrape https://example.com",
    "Summarize the following text: 'Artificial Intelligence is transforming industries...'",
    "Analyze this dataset: [1, 2, 3, 4, 5, 10, 20, 30]",
    "Send an email notification to admin@example.com saying the task is complete",

    // === 2-STEP WORKFLOWS ===
    "Scrape https://news.ycombinator.com and summarize the content",
    "Fetch user data and validate it against our schema",
    "Generate a bar chart showing sales data: Q1=100, Q2=150, Q3=200, Q4=250",
    "Analyze website traffic data [100, 200, 150, 300] and send a notification with insights",

    // === 3+ STEP COMPLEX WORKFLOWS ===
    "Scrape https://example.com/data, analyze the numbers, and create a report with charts",
    "Fetch product data, validate it, transform to uppercase, and generate a summary report",
    "Scrape competitor website, summarize findings, create a chart, and compile a PDF report",
    "Get data from API, analyze trends, validate quality, and notify stakeholders with results",

    // === EDGE CASES & ADVANCED FEATURES ===
    "Create a comprehensive sales report with multiple charts and summaries",
    "Perform AI transformation on customer feedback data and generate insights",
    "Validate user input data and create detailed quality report",
    "Scrape multiple data sources, consolidate, analyze, and create executive summary PDF",
];

interface TestResult {
    prompt: string;
    success: boolean;
    canExecute: boolean;
    nodeCount: number;
    agentTypes: string[];
    errors: string[];
    workflow?: any;
}

async function runComprehensiveTests() {
    console.log("=== COMPREHENSIVE WORKFLOW TESTING ===\n");
    console.log(`Testing ${TEST_PROMPTS.length} diverse prompts...\n`);

    const results: TestResult[] = [];

    for (let i = 0; i < TEST_PROMPTS.length; i++) {
        const prompt = TEST_PROMPTS[i];
        console.log(`\n[${i + 1}/${TEST_PROMPTS.length}] Testing: "${prompt}"`);
        console.log("-".repeat(80));

        try {
            const result = await planWorkflow(prompt);

            const testResult: TestResult = {
                prompt,
                success: true,
                canExecute: result.canExecute,
                nodeCount: result.workflow?.nodes?.length || 0,
                agentTypes: result.workflow?.nodes?.map(n => n.agentType) || [],
                errors: [],
                workflow: result.workflow
            };

            if (result.canExecute) {
                console.log(`✅ EXECUTABLE - ${testResult.nodeCount} nodes`);
                console.log(`   Agents: ${testResult.agentTypes.join(" → ")}`);

                // Display workflow structure
                if (result.workflow) {
                    console.log(`\n   Workflow Structure:`);
                    result.workflow.nodes.forEach((node: any) => {
                        console.log(`   - ${node.id} (${node.agentType})`);
                        console.log(`     Inputs: ${JSON.stringify(node.inputs)}`);
                        if (node.dependencies?.length > 0) {
                            console.log(`     Dependencies: ${node.dependencies.join(", ")}`);
                        }
                    });
                }
            } else {
                console.log(`❌ NOT EXECUTABLE`);
                console.log(`   Reason: ${result.reasonIfCannot}`);
                testResult.errors.push(result.reasonIfCannot || "Unknown reason");
            }

            results.push(testResult);

        } catch (error) {
            console.log(`❌ ERROR: ${error instanceof Error ? error.message : String(error)}`);
            results.push({
                prompt,
                success: false,
                canExecute: false,
                nodeCount: 0,
                agentTypes: [],
                errors: [error instanceof Error ? error.message : String(error)]
            });
        }
    }

    // === SUMMARY REPORT ===
    console.log("\n\n" + "=".repeat(80));
    console.log("=== TEST SUMMARY ===");
    console.log("=".repeat(80));

    const successful = results.filter(r => r.success && r.canExecute);
    const failed = results.filter(r => !r.success || !r.canExecute);

    console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
    console.log(`❌ Failed: ${failed.length}/${results.length}`);

    // Agent coverage
    const allAgents = new Set(successful.flatMap(r => r.agentTypes));
    console.log(`\n📊 Agent Coverage: ${allAgents.size} unique agents used`);
    console.log(`   Agents: ${Array.from(allAgents).join(", ")}`);

    // Workflow complexity
    const avgNodes = successful.reduce((sum, r) => sum + r.nodeCount, 0) / successful.length;
    console.log(`\n📈 Average Workflow Complexity: ${avgNodes.toFixed(1)} nodes`);

    // Failed cases
    if (failed.length > 0) {
        console.log(`\n❌ Failed Cases:`);
        failed.forEach((r, i) => {
            console.log(`   ${i + 1}. "${r.prompt}"`);
            console.log(`      Error: ${r.errors.join(", ")}`);
        });
    }

    // Save detailed results
    const fs = require('fs');
    const resultsPath = './test_results.json';
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Detailed results saved to: ${resultsPath}`);

    return results;
}

runComprehensiveTests().catch(console.error);
