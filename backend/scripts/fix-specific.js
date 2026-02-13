const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://devuser:devpass@localhost:5433/ai_workflow_dev' });

async function fixSpecific() {
  const client = await pool.connect();
  try {
    const taskId = '27a08cf8-d4cd-4544-8a64-6d03050281aa';
    
    console.log('Checking for logs with task ID:', taskId);
    const check = await client.query(`
      SELECT COUNT(*) FROM task_logs WHERE task_id = $1
    `, [taskId]);
    console.log('Found logs:', check.rows[0].count);
    
    if (check.rows[0].count > 0) {
      console.log('Deleting logs for this task...');
      const result = await client.query(`
        DELETE FROM task_logs WHERE task_id = $1
      `, [taskId]);
      console.log('Deleted:', result.rowCount);
    }
    
    console.log('Checking if task exists...');
    const taskCheck = await client.query(`
      SELECT id FROM tasks WHERE id = $1
    `, [taskId]);
    console.log('Task exists:', taskCheck.rows.length > 0);
    
    if (taskCheck.rows.length === 0) {
      console.log('Task does not exist - logs were orphaned');
    }
    
    console.log('\nChecking ALL logs without matching tasks...');
    const allOrphaned = await client.query(`
      SELECT tl.task_id, COUNT(*) as cnt
      FROM task_logs tl
      LEFT JOIN tasks t ON tl.task_id = t.id
      WHERE t.id IS NULL
      GROUP BY tl.task_id
    `);
    console.log('All orphaned logs by task_id:', allOrphaned.rows);
    
    if (allOrphaned.rows.length > 0) {
      console.log('Deleting all orphaned logs...');
      const delResult = await client.query(`
        DELETE FROM task_logs
        WHERE task_id NOT IN (SELECT id FROM tasks)
      `);
      console.log('Total deleted:', delResult.rowCount);
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}
fixSpecific();
