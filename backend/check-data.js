const pool = require('./dist/db.js').default;

async function checkData() {
  try {
    console.log('Checking database data...');
    
    // Check organizations
    const orgs = await pool.query('SELECT * FROM organizations');
    console.log(`Organizations count: ${orgs.rows.length}`);
    
    // Check organization_members
    const members = await pool.query('SELECT * FROM organization_members');
    console.log(`Organization members count: ${members.rows.length}`);
    
    // Check workflow_templates
    const templates = await pool.query('SELECT id, name, owner_id, organization_id FROM workflow_templates LIMIT 3');
    console.log('Sample workflow_templates:');
    templates.rows.forEach(row => {
      console.log(`  - ${row.id}: ${row.name} (owner: ${row.owner_id}, org: ${row.organization_id})`);
    });
    
    // Check jobs
    const jobs = await pool.query('SELECT id, title, template_id, template_version FROM jobs LIMIT 3');
    console.log('Sample jobs:');
    jobs.rows.forEach(row => {
      console.log(`  - ${row.id}: ${row.title} (template: ${row.template_id}, version: ${row.template_version})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Data check failed:', error);
    process.exit(1);
  }
}

checkData();
