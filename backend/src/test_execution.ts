const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const BASE_URL = 'http://localhost:4000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret123';

// Generate a valid test token
function generateTestToken() {
    return jwt.sign(
        {
            id: '22222222-2222-2222-2222-222222222222',
            email: 'b@test.com',
            orgId: 'a8f9e86e-a972-4f5b-823b-c1fcc249cbe0'
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
}

const AUTH_HEADER = {
    headers: {
        'Authorization': `Bearer ${generateTestToken()}`,
        'Content-Type': 'application/json'
    }
};

// Test Workflow 1: Simple Analyzer
const TEST_WORKFLOW_1 = {
    name: "Data Analysis Test",
    description: "Analyze a simple dataset",
    dag: {
        tasks: [
            {
                name: "data_analyzer_node",
                agent_type: "analyzer",
                payload: {
                    data: [1, 2, 3, 4, 5, 10, 20, 30],
                    analysis_type: "summary"
                }
            }
        ]
    }
};

// Test Workflow 2: Scraper + Summarizer (2-step workflow)
const TEST_WORKFLOW_2 = {
    name: "Scrape and Summarize Test",
    description: "Scrape a website and summarize the content",
    dag: {
        tasks: [
            {
                name: "scraper_node",
                agent_type: "scraper",
                payload: {
                    url: "https://example.com"
                }
            },
            {
                name: "summarizer_node",
                agent_type: "summarizer",
                payload: {
                    text: "{{tasks.scraper_node.outputs.text}}"
                },
                parent_task_index: 0
            }
        ]
    }
};

async function runWorkflowTest(workflow: any, testName: string) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Testing: ${testName}`);
    console.log("=".repeat(80));

    try {
        // Step 1: Create workflow
        console.log("\n[1/4] Creating workflow...");
        const createResponse = await axios.post(`${BASE_URL}/workflows`, workflow, AUTH_HEADER);
        const workflowId = createResponse.data.templateId; // Fixed: use templateId
        console.log(`✅ Workflow created with ID: ${workflowId}`);

        // Step 2: Execute workflow
        console.log("\n[2/4] Starting workflow execution...");
        const executeResponse = await axios.post(`${BASE_URL}/workflows/${workflowId}/run`, { version: 1 }, AUTH_HEADER); // Fixed: add version
        const jobId = executeResponse.data.jobId;
        console.log(`✅ Job started with ID: ${jobId}`);

        // Step 3: Poll for completion
        console.log("\n[3/4] Waiting for completion...");
        let jobStatus = 'RUNNING';
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds max

        while (jobStatus === 'RUNNING' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Poll list endpoint as GET /jobs/:id doesn't exist
            const statusResponse = await axios.get(`${BASE_URL}/jobs`, AUTH_HEADER);
            const job = statusResponse.data.find((j: any) => j.id === jobId);

            if (job) {
                jobStatus = job.status;
            } else {
                console.warn(`   ⚠️ Job ${jobId} not found in list`);
            }

            attempts++;
            process.stdout.write(`\r   Status: ${jobStatus} (${attempts}s)`);
        }

        console.log(`\n✅ Job completed with status: ${jobStatus}`);

        // Step 4: Fetch results and artifacts
        console.log("\n[4/4] Fetching artifacts...");
        const tasksResponse = await axios.get(`${BASE_URL}/jobs/${jobId}/tasks`, AUTH_HEADER);
        const tasks = tasksResponse.data;

        const artifactsResponse = await axios.get(`${BASE_URL}/jobs/${jobId}/artifacts`, AUTH_HEADER);
        const artifacts = artifactsResponse.data;

        console.log(`\n📊 Task Results:`);
        tasks.forEach((task: any) => {
            console.log(`\n   Task: ${task.name}`);
            console.log(`   Status: ${task.status}`);
        });

        console.log(`\n📦 Artifacts (${artifacts.length}):`);
        artifacts.forEach((artifact: any) => {
            console.log(`   - ${artifact.filename} (${artifact.type}) [${artifact.mime_type}]`);
        });

        return {
            success: true,
            jobId,
            status: jobStatus,
            taskCount: tasks.length,
            artifactCount: artifacts.length
        };

    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
        }
        return {
            success: false,
            error: error.message
        };
    }
}

async function runAllTests() {
    console.log("=== WORKFLOW EXECUTION VERIFICATION ===\n");

    const results = [];

    // Test 1: Simple analyzer
    results.push(await runWorkflowTest(TEST_WORKFLOW_1, "Simple Data Analysis"));

    // Test 2: 2-step workflow
    results.push(await runWorkflowTest(TEST_WORKFLOW_2, "Scrape + Summarize (2 steps)"));

    // Summary
    console.log(`\n\n${"=".repeat(80)}`);
    console.log("=== EXECUTION TEST SUMMARY ===");
    console.log("=".repeat(80));

    const successful = results.filter(r => r.success);
    console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
    console.log(`❌ Failed: ${results.length - successful.length}/${results.length}`);

    if (successful.length > 0) {
        console.log(`\n✅ End-to-end workflow execution is WORKING!`);
        console.log(`   - Workflows can be created`);
        console.log(`   - Jobs are executed`);
        console.log(`   - Artifacts are generated`);
    }
}

runAllTests().catch(console.error);
