/**
 * Manual Workflow Execution Test - Tests real agent execution via API
 *
 * This script submits jobs via the backend API to verify that the orchestrator
 * pipeline works correctly for manual job creation, including task execution,
 * artifact generation, and job tracking.
 */

import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';

// Helper to create a job and track execution
async function createAndTrackJob(jobPayload: {
  title: string;
  tasks: Array<{
    name: string;
    agent_type: string;
    payload: Record<string, unknown>;
    parent_task_index?: number;
  }>;
}) {
  console.log('\n📋 Job Payload:', JSON.stringify(jobPayload, null, 2));

  // Step 1: Create job via API
  console.log('\n[1/4] Creating job via backend API...');
  const createResponse = await axios.post(`${API_BASE}/jobs`, jobPayload);
  const jobId = createResponse.data.jobId || createResponse.data.id;

  if (!jobId) {
    throw new Error('No job ID returned from createJob');
  }

  console.log(`✅ Job created: ${jobId}`);

  // Step 2: Poll for job completion
  console.log('\n[2/4] Tracking job execution...');
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes with 5-second intervals
  let finalStatus = '';

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const statusResponse = await axios.get(`${API_BASE}/jobs/${jobId}`);
    const job = statusResponse.data;
    finalStatus = job.status;

    console.log(`   Attempt ${attempts + 1}: Status = ${job.status}`);

    // Fetch tasks progress
    try {
      const tasksResponse = await axios.get(`${API_BASE}/jobs/${jobId}/tasks`);
      const tasks = tasksResponse.data || [];
      const completed = tasks.filter((t: { status: string }) => t.status === 'SUCCESS').length;
      console.log(`   Tasks: ${completed}/${tasks.length} completed`);
    } catch (e) {
      // Tasks endpoint might not exist yet
    }

    if (job.status === 'SUCCESS' || job.status === 'FAILED') {
      break;
    }

    attempts++;
  }

  // Step 3: Fetch final results
  console.log('\n[3/4] Fetching execution results...');

  // Get job details
  const finalJobResponse = await axios.get(`${API_BASE}/jobs/${jobId}`);
  const finalJob = finalJobResponse.data;

  // Get tasks
  let tasks: Array<Record<string, unknown>> = [];
  try {
    const tasksResponse = await axios.get(`${API_BASE}/jobs/${jobId}/tasks`);
    tasks = tasksResponse.data || [];
  } catch (e) {
    console.log('   (Tasks endpoint not available)');
  }

  // Get artifacts
  let artifacts: Array<Record<string, unknown>> = [];
  try {
    const artifactsResponse = await axios.get(`${API_BASE}/artifacts?job_id=${jobId}`);
    artifacts = artifactsResponse.data || [];
  } catch (e) {
    console.log('   (Artifacts endpoint not available)');
  }

  // Get logs
  let logs: Array<Record<string, unknown>> = [];
  try {
    if (tasks.length > 0) {
      const latestTask = tasks[tasks.length - 1];
      const logsResponse = await axios.get(`${API_BASE}/logs?task_id=${latestTask.id}`);
      logs = logsResponse.data || [];
    }
  } catch (e) {
    console.log('   (Logs endpoint not available)');
  }

  console.log(`\n📊 Final Status: ${finalStatus}`);
  console.log(`📊 Tasks: ${tasks.length} total`);
  console.log(`📊 Artifacts: ${artifacts.length} generated`);
  console.log(`📊 Logs: ${logs.length} entries`);

  // Step 4: Quality assessment
  console.log('\n[4/4] Quality Assessment...');

  type TaskLike = { name?: unknown; status?: unknown };
  const taskStatuses = tasks
    .map((t) => t as TaskLike)
    .map((t) => ({
      name: typeof t.name === 'string' ? t.name : '(unknown)',
      status: typeof t.status === 'string' ? t.status : '(unknown)',
    }));

  console.log('\n   Task Statuses:');
  taskStatuses.forEach((t: { name: string; status: string }) => {
    const icon = t.status === 'SUCCESS' ? '✅' : t.status === 'FAILED' ? '❌' : '⏳';
    console.log(`     ${icon} ${t.name}: ${t.status}`);
  });

  console.log('\n   Artifacts:');
  artifacts.forEach((a: { filename?: string; type?: string; size?: number }) => {
    console.log(`     📦 ${a.filename || 'unnamed'} (${a.type || 'unknown'}, ${a.size || 0} bytes)`);
  });

  const success =
    finalStatus === 'SUCCESS' &&
    tasks
      .map((t) => t as TaskLike)
      .every((t) => (typeof t.status === 'string' ? t.status === 'SUCCESS' : false));
  console.log(`\n🎯 Result: ${success ? '✅ ALL TASKS SUCCEEDED' : '❌ SOME TASKS FAILED'}`);

  return {
    jobId,
    status: finalStatus,
    tasks,
    artifacts,
    logs,
    success
  };
}

// Test 1: Simple analyzer workflow
async function testAnalyzerWorkflow() {
  console.log('\n=== TEST 1: Analyzer Workflow ===\n');

  return createAndTrackJob({
    title: 'Test: Data Analysis',
    tasks: [
      {
        name: 'data_analyzer',
        agent_type: 'analyzer',
        payload: {
          data: [10, 20, 30, 40, 50, 100, 200, 300],
          analysis_type: 'comprehensive'
        }
      }
    ]
  });
}

// Test 2: Multi-step workflow with dependencies
async function testMultiStepWorkflow() {
  console.log('\n=== TEST 2: Multi-Step Workflow ===\n');

  return createAndTrackJob({
    title: 'Test: Scrape → Analyze → Report',
    tasks: [
      {
        name: 'scraper_task',
        agent_type: 'scraper',
        payload: {
          url: 'https://example.com',
          selector: 'body'
        }
      },
      {
        name: 'analyzer_task',
        agent_type: 'analyzer',
        payload: {
          analysis_type: 'summary'
        },
        parent_task_index: 0 // Depends on scraper
      },
      {
        name: 'designer_task',
        agent_type: 'designer',
        payload: {
          title: 'Analysis Report',
          sections: [
            { heading: 'Results', content: '{{analyzer_task.output}}' }
          ]
        },
        parent_task_index: 1 // Depends on analyzer
      }
    ]
  });
}

// Test 3: Chart generation workflow
async function testChartWorkflow() {
  console.log('\n=== TEST 3: Chart Generation ===\n');

  return createAndTrackJob({
    title: 'Test: Create Sales Chart',
    tasks: [
      {
        name: 'chart_task',
        agent_type: 'chart',
        payload: {
          type: 'bar',
          title: 'Monthly Sales',
          x: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
          y: [100, 150, 200, 180, 250],
          x_label: 'Month',
          y_label: 'Sales ($)'
        }
      }
    ]
  });
}

// Main execution
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Manual Job Execution Test - Orchestrator Pipeline      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nAPI Base: ${API_BASE}`);

  const results: Array<{ name: string; success: boolean }> = [];

  try {
    const result1 = await testAnalyzerWorkflow();
    results.push({ name: 'Analyzer Workflow', success: result1.success });
  } catch (error: any) {
    console.error('\n❌ Test 1 failed:', error.message);
    results.push({ name: 'Analyzer Workflow', success: false });
  }

  try {
    const result2 = await testMultiStepWorkflow();
    results.push({ name: 'Multi-Step Workflow', success: result2.success });
  } catch (error: any) {
    console.error('\n❌ Test 2 failed:', error.message);
    results.push({ name: 'Multi-Step Workflow', success: false });
  }

  try {
    const result3 = await testChartWorkflow();
    results.push({ name: 'Chart Workflow', success: result3.success });
  } catch (error: any) {
    console.error('\n❌ Test 3 failed:', error.message);
    results.push({ name: 'Chart Workflow', success: false });
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  results.forEach((r) => {
    const icon = r.success ? '✅' : '❌';
    console.log(`   ${icon} ${r.name}`);
  });

  const allPassed = results.every((r) => r.success);
  console.log(`\n🎯 Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
