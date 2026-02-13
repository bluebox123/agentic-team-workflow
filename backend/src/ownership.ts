import pool from "./db";

/**
 * Ensure the authenticated user owns the job
 */
export async function assertJobOwnership(
  jobId: string,
  userId: string
) {
  const { rowCount } = await pool.query(
    `
    SELECT 1
    FROM jobs
    WHERE id = $1 AND user_id = $2
    `,
    [jobId, userId]
  );

  if (rowCount === 0) {
    const err: any = new Error("Not authorized");
    err.status = 403;
    throw err;
  }
}

/**
 * Resolve job ownership from a task
 */
export async function assertTaskOwnership(
  taskId: string,
  userId: string
) {
  const { rows } = await pool.query(
    `
    SELECT j.user_id, j.organization_id
    FROM tasks t
    JOIN jobs j ON t.job_id = j.id
    WHERE t.id = $1
    `,
    [taskId]
  );

  if (!rows.length) {
    const err: any = new Error("Task not found");
    err.status = 404;
    throw err;
  }

  const job = rows[0];
  
  // Check if user owns the job directly
  if (job.user_id === userId) {
    return;
  }
  
  // Check if it's an org job and user is a member
  if (job.organization_id) {
    const { rowCount } = await pool.query(
      `
      SELECT 1
      FROM organization_members
      WHERE organization_id = $1 AND user_id = $2
      `,
      [job.organization_id, userId]
    );
    
    if (rowCount && rowCount > 0) {
      return;
    }
  }

  const err: any = new Error("Not authorized");
  err.status = 403;
  throw err;
}
