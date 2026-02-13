const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://devuser:devpass@localhost:5433/ai_workflow_dev' });

async function deleteSpecific() {
  const client = await pool.connect();
  try {
    const taskId = '27a08cf8-d4cd-4544-8a64-6d03050281aa';
    
    console.log('Checking for logs with task ID:', taskId);
    const check = await client.query(
      'SELECT COUNT(*) FROM task_logs WHERE task_id = $1',
      [taskId]
    );
    console.log('Found logs:', check.rows[0].count);
    
    if (check.rows[0].count > 0) {
      console.log('Deleting logs...');
      const result = await client.query(
        'DELETE FROM task_logs WHERE task_id = $1',
        [taskId]
      );
      console.log('Deleted:', result.rowCount);
    }
    
    console.log('Done');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}
deleteSpecific();
