const pool = require('./dist/db.js').default;
const jwt = require('jsonwebtoken');

async function testJobsEndpoint() {
  try {
    console.log('Testing jobs endpoint...');
    
    // Create test request with user context
    const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjIyMjIyMjIyLTIyMjItMjIyMi0yMjIyLTIyMjIyMjIyMjIyMiIsImVtYWlsIjoiYkB0ZXN0LmNvbSIsImlhdCI6MTc2NzAyMTA2NSwiZXhwIjoxNzY3MTA3NDY1fQ.sPaI6mMP8uorjvGRtGA4-bNIZntiRZWvlbIUGGD5v1c';
    
    const payload = jwt.verify(testToken, process.env.JWT_SECRET || 'fallback-secret');
    console.log('Token payload:', payload);
    
    // Test the exact query from jobs endpoint
    const { rows } = await pool.query(
      `
      SELECT 
        j.id, 
        j.title, 
        j.status, 
        j.created_at,
        j.template_id,
        j.template_version,
        wt.name AS template_name
      FROM jobs j
      LEFT JOIN workflow_templates wt
        ON j.template_id = wt.id
      WHERE
        (
          j.organization_id IS NULL
          OR j.organization_id IN (
            SELECT organization_id
            FROM organization_members
            WHERE user_id = $1
          )
        )
      ORDER BY j.created_at DESC
      `,
      [payload.id]
    );
    
    console.log(`Found ${rows.length} jobs:`);
    rows.forEach(job => {
      console.log(`  - ${job.id}: ${job.title} (${job.status})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Jobs endpoint test failed:', error);
    process.exit(1);
  }
}

testJobsEndpoint();
