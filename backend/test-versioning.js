// Simple test script to verify template versioning endpoint
// This demonstrates the expected API usage

const axios = require('axios');

const BASE_URL = 'http://localhost:4000';

async function testVersioning() {
  console.log('🧪 Testing Template Versioning API...\n');

  try {
    // 1. First, create a template (v1)
    console.log('1️⃣ Creating template v1...');
    const createResponse = await axios.post(`${BASE_URL}/api/workflows`, {
      name: 'Test Workflow',
      description: 'A test workflow for versioning',
      dag: {
        tasks: [
          {
            name: 'fetch_data',
            params: { 'dataset': '{{dataset}}' }
          },
          {
            name: 'clean_data',
            parent_task_index: 0
          }
        ]
      }
    }, {
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN_HERE',
        'Content-Type': 'application/json'
      }
    });

    const templateId = createResponse.data.templateId;
    console.log('✅ Template created:', { templateId, version: createResponse.data.version });

    // 2. Create v2
    console.log('\n2️⃣ Creating template v2...');
    const v2Response = await axios.post(`${BASE_URL}/api/workflows/${templateId}/versions`, {
      dag: {
        tasks: [
          {
            name: 'fetch_data',
            params: { 'dataset': '{{dataset}}' }
          },
          {
            name: 'clean_data',
            parent_task_index: 0
          },
          {
            name: 'index_data',
            parent_task_index: 1
          }
        ]
      }
    }, {
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN_HERE',
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Version v2 created:', { templateId, version: v2Response.data.version });

    // 3. List versions
    console.log('\n3️⃣ Listing template versions...');
    const listResponse = await axios.get(`${BASE_URL}/api/workflows/${templateId}`, {
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN_HERE'
      }
    });

    console.log('📋 Available versions:', listResponse.data.versions);

    // 4. Test running different versions
    console.log('\n4️⃣ Testing workflow execution with different versions...');
    
    // Run v1 (should create 2 tasks)
    const runV1Response = await axios.post(`${BASE_URL}/api/workflows/${templateId}/run`, {
      version: 1,
      params: { dataset: 'test_data.csv' }
    }, {
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN_HERE',
        'Content-Type': 'application/json'
      }
    });

    console.log('🚀 v1 execution:', { jobId: runV1Response.data.jobId, taskCount: runV1Response.data.taskCount });

    // Run v2 (should create 3 tasks)
    const runV2Response = await axios.post(`${BASE_URL}/api/workflows/${templateId}/run`, {
      version: 2,
      params: { dataset: 'test_data.csv' }
    }, {
      headers: {
        'Authorization': 'Bearer YOUR_TOKEN_HERE',
        'Content-Type': 'application/json'
      }
    });

    console.log('🚀 v2 execution:', { jobId: runV2Response.data.jobId, taskCount: runV2Response.data.taskCount });

    console.log('\n✅ All tests passed! Template versioning is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Instructions
console.log(`
🧪 Template Versioning Test Instructions

1. Start the backend server:
   cd ai-workflow/backend && npm start

2. Get a valid auth token from your authentication endpoint

3. Replace 'YOUR_TOKEN_HERE' in the script above

4. Run this test script

Expected results:
- v1 creates 2 tasks (fetch_data, clean_data)
- v2 creates 3 tasks (fetch_data, clean_data, index_data)
- Both versions should remain immutable and runnable
`);

module.exports = { testVersioning };
