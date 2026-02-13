const pool = require('./dist/db.js').default;

async function checkSchema() {
  try {
    console.log('Checking workflow_templates schema...');
    
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'workflow_templates' 
      ORDER BY ordinal_position
    `);
    
    console.log('workflow_templates columns:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Schema check failed:', error);
    process.exit(1);
  }
}

checkSchema();
