const pool = require('./dist/db.js').default;

async function checkJobsSchema() {
  try {
    console.log('Checking jobs table schema...');
    
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'jobs' 
      ORDER BY ordinal_position
    `);
    
    console.log('jobs table columns:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Schema check failed:', error);
    process.exit(1);
  }
}

checkJobsSchema();
