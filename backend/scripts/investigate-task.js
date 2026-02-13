const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://devuser:devpass@localhost:5433/ai_workflow_dev' });

async function investigate() {
  const client = await pool.connect();
  try {
    const taskId = '27a08cf8-d4cd-4544-8a64-6d03050281aa';
    
    console.log('Checking task', taskId);
    const taskResult = await client.query(`
      SELECT id, job_id, name, status FROM tasks WHERE id = $1
    `, [taskId]);
    console.log('Task found:', taskResult.rows);
    
    if (taskResult.rows.length > 0) {
      const jobId = taskResult.rows[0].job_id;
      console.log('Checking job', jobId);
      const jobResult = await client.query(`
        SELECT id, status, created_at FROM jobs WHERE id = $1
      `, [jobId]);
      console.log('Job found:', jobResult.rows);
      
      if (jobResult.rows.length > 0) {
        const job = jobResult.rows[0];
        const ageDays = (new Date() - new Date(job.created_at)) / (1000 * 60 * 60 * 24);
        console.log('Job age in days:', ageDays);
        console.log('Job eligible for cleanup (>=7 days, status SUCCESS/FAILED/CANCELLED):', 
          ageDays >= 7 && ['SUCCESS', 'FAILED', 'CANCELLED'].includes(job.status));
      }
    }
    
    console.log('Checking task_logs for this task...');
    const logsResult = await client.query(`
      SELECT COUNT(*) FROM task_logs WHERE task_id = $1
    `, [taskId]);
    console.log('Task logs count:', logsResult.rows[0].count);
    
  } catch (e) {
    console.error(e);
  } finally {
    client.release();
    await pool.end();
  }
}
investigate();
