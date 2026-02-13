const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://devuser:devpass@localhost:5433/ai_workflow_dev' });

async function deepInvestigate() {
  const client = await pool.connect();
  try {
    console.log('=== Finding old jobs (7+ days, terminal status) ===');
    const oldJobs = await client.query(`
      SELECT id, status, created_at, 
        EXTRACT(DAY FROM NOW() - created_at) as age_days
      FROM jobs 
      WHERE created_at < NOW() - INTERVAL '7 days'
        AND status IN ('SUCCESS', 'FAILED', 'CANCELLED')
    `);
    console.log(`Found ${oldJobs.rows.length} old jobs`);
    
    for (const job of oldJobs.rows.slice(0, 5)) {
      console.log(`Job ${job.id} (status=${job.status}, age=${Math.floor(job.age_days)} days)`);
      
      const tasks = await client.query(`
        SELECT id, name, status FROM tasks WHERE job_id = $1
      `, [job.id]);
      console.log(`  Tasks: ${tasks.rows.length}`);
      
      for (const task of tasks.rows) {
        const logs = await client.query(`
          SELECT COUNT(*) FROM task_logs WHERE task_id = $1
        `, [task.id]);
        console.log(`    Task ${task.id.substring(0, 8)}... (${task.status}) - ${logs.rows[0].count} logs`);
      }
    }
    
    console.log('\n=== Checking for any logs with specific task ID ===');
    const specific = await client.query(`
      SELECT task_id, COUNT(*) as cnt 
      FROM task_logs 
      GROUP BY task_id 
      HAVING task_id NOT IN (SELECT id FROM tasks)
      LIMIT 10
    `);
    console.log('Task IDs in logs but not in tasks:', specific.rows);
    
  } catch (e) {
    console.error(e);
  } finally {
    client.release();
    await pool.end();
  }
}
deepInvestigate();
