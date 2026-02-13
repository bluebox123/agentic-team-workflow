const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://devuser:devpass@localhost:5433/ai_workflow_dev' });

async function fix() {
  const client = await pool.connect();
  try {
    console.log('Checking for orphaned task_logs...');
    const check = await client.query(`
      SELECT COUNT(*) FROM task_logs
      WHERE task_id NOT IN (SELECT id FROM tasks)
    `);
    console.log('Found orphaned task_logs:', check.rows[0].count);
    
    if (check.rows[0].count > 0) {
      const result = await client.query(`
        DELETE FROM task_logs
        WHERE task_id NOT IN (SELECT id FROM tasks)
      `);
      console.log('Deleted orphaned task_logs:', result.rowCount);
    }
    
    console.log('Checking for orphaned outputs...');
    const check2 = await client.query(`
      SELECT COUNT(*) FROM outputs
      WHERE task_id NOT IN (SELECT id FROM tasks)
    `);
    console.log('Found orphaned outputs:', check2.rows[0].count);
    
    if (check2.rows[0].count > 0) {
      const result2 = await client.query(`
        DELETE FROM outputs
        WHERE task_id NOT IN (SELECT id FROM tasks)
      `);
      console.log('Deleted orphaned outputs:', result2.rowCount);
    }
    
    console.log('Checking for orphaned artifacts...');
    const check3 = await client.query(`
      SELECT COUNT(*) FROM artifacts
      WHERE task_id NOT IN (SELECT id FROM tasks)
    `);
    console.log('Found orphaned artifacts:', check3.rows[0].count);
    
    if (check3.rows[0].count > 0) {
      const result3 = await client.query(`
        DELETE FROM artifacts
        WHERE task_id NOT IN (SELECT id FROM tasks)
      `);
      console.log('Deleted orphaned artifacts:', result3.rowCount);
    }
    
    console.log('Done!');
  } catch (e) {
    console.error(e);
  } finally {
    client.release();
    await pool.end();
  }
}
fix();
