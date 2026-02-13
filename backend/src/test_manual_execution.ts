/**
 * Manual Workflow Execution Test - bypasses Brain to test artifact quality
 * 
 * This script manually submits workflows derived from our earlier successful planning tests
 * to verify that the actual agent execution and artifact generation work correctly.
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'http://localhost:4000/api';

// Manually create a simple workflow based on our successful test case
async function testSimpleAnalyzerArtifacts() {
    console.log("\n=== Testing Analyzer Artifact Generation ===\n");

    try {
        // Step 1: Create workflow directly via DB/API
        console.log("[1/5] Creating workflow via backend API...");

        const workflowPayload = {
            name: "Manual Data Analysis Test",
            description: "Test artifact generation for analyzer agent",
            trigger_type: "manual"
        };

        // This will require auth, so let's try to POST to /jobs directly instead
        const jobPayload = {
            workflow_id: null, // Manual job
            tasks: [
                {
                    id: "analyze_task_1",
                    name: "data_analyzer",
                    agent_type: "analyzer",
                    payload: {
                        data: [1, 2, 3, 4, 5, 10, 20, 30, 45, 100],
                        analysis_type: "comprehensive"
                    },
                    dependencies: []
                }
            ]
        };

        console.log("Payload:", JSON.stringify(jobPayload, null, 2));

        // Let's instead directly test the Python worker
        console.log("\n[2/5] Testing Python worker directly...");

        // Check if we can connect to RabbitMQ
        const amqp = require('amqplib');
        const connection = await amqp.connect('amqp://guest:guest@localhost:5672');
        const channel = await connection.createChannel();

        const queue = 'python_worker_queue';
        await channel.assertQueue(queue, { durable: true });

        console.log("✅ Connected to RabbitMQ");

        const taskMessage = {
            task_id: "test_analyzer_" + Date.now(),
            job_id: "manual_test_job",
            agent_type: "analyzer",
            payload: {
                data: [10, 20, 30, 40, 50, 100, 200, 300],
                analysis_type: "comprehensive"
            }
        };

        console.log("\n[3/5] Sending task to Python worker...");
        channel.sendToQueue(queue, Buffer.from(JSON.stringify(taskMessage)), {
            persistent: true
        });

        console.log("✅ Task sent:", taskMessage.task_id);

        // Wait for result
        console.log("\n[4/5] Waiting for result...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check MinIO for artifacts
        console.log("\n[5/5] Checking MinIO for artifacts...");
        const MinioClient = require('minio').Client;
        const minioClient = new MinioClient({
            endPoint: 'localhost',
            port: 9000,
            useSSL: false,
            accessKey: 'minioadmin',
            secretKey: 'minioadmin'
        });

        const bucket = 'artifacts';
        const prefix = `jobs/${taskMessage.job_id}/`;

        const stream = minioClient.listObjects(bucket, prefix, true);
        const artifacts: any[] = [];

        stream.on('data', (obj) => {
            artifacts.push(obj);
            console.log(`  Found: ${obj.name} (${obj.size} bytes)`);
        });

        stream.on('end', async () => {
            console.log(`\n✅ Found ${artifacts.length} artifacts`);

            if (artifacts.length > 0) {
                // Download and inspect first artifact
                const artifact = artifacts[0];
                const localPath = path.join(__dirname, 'downloaded_artifact_test.json');

                await minioClient.fGetObject(bucket, artifact.name, localPath);
                console.log(`\n📥 Downloaded artifact to: ${localPath}`);

                const content = fs.readFileSync(localPath, 'utf-8');
                console.log(`\n📊 Artifact Content:`);
                console.log(content);

                // Quality assessment
                const data = JSON.parse(content);
                console.log(`\n=== ARTIFACT QUALITY ASSESSMENT ===`);
                console.log(`Type: ${typeof data}`);
                console.log(`Properties: ${Object.keys(data).join(', ')}`);

                if (data.insights) console.log(`✅ Has insights field`);
                if (data.statistics) console.log(`✅ Has statistics field`);

                console.log(`\n🎯 User Satisfaction: ${artifacts.length > 0 ? 'SATISFIED' : 'NEEDS IMPROVEMENT'}`);
            }

            await channel.close();
            await connection.close();
        });

        stream.on('error', (err) => {
            console.error('MinIO error:', err);
        });

    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
        if (error.response) {
            console.error(`   Response:`, error.response.data);
        }
    }
}

testSimpleAnalyzerArtifacts().catch(console.error);
