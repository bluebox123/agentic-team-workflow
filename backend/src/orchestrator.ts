import pool from "./db";
import { enqueueTask } from "./mq";
import { resolveTaskInputs } from "./templateUtils";
import { setTimeout } from "timers/promises";

/**
 * Extract task dependencies from template placeholders in payload
 * Looks for {{tasks.<taskName>.outputs.<field>}} patterns
 */
function extractTemplateDependencies(payload: any): string[] {
  const deps = new Set<string>();
  const templateRegex = /\{\{tasks\.([a-zA-Z0-9_]+)\.outputs\./g;
  
  function scan(obj: any) {
    if (typeof obj === 'string') {
      let match;
      while ((match = templateRegex.exec(obj)) !== null) {
        deps.add(match[1]);
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(scan);
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(scan);
    }
  }
  
  scan(payload);
  return Array.from(deps);
}

/**
 * Check if all template dependencies are satisfied (SUCCESS status)
 */
async function areTemplateDependenciesSatisfied(
  jobId: string, 
  payload: any, 
  parentTaskId: string | null
): Promise<{ satisfied: boolean; missing: string[] }> {
  const templateDeps = extractTemplateDependencies(payload);
  
  if (templateDeps.length === 0) {
    return { satisfied: true, missing: [] };
  }
  
  // Query status of all tasks with names matching template dependencies
  const { rows } = await pool.query(
    `
    SELECT name, status 
    FROM tasks 
    WHERE job_id = $1 AND name = ANY($2)
    `,
    [jobId, templateDeps]
  );
  
  const statusMap = new Map(rows.map(r => [r.name, r.status]));
  const missing: string[] = [];
  
  for (const dep of templateDeps) {
    const status = statusMap.get(dep);
    if (status !== 'SUCCESS') {
      missing.push(dep);
    }
  }
  
  return { satisfied: missing.length === 0, missing };
}

/**
 * Phase 8.4.4: Attach artifact metadata to Designer tasks (updated for 8.4.3)
 */
async function attachArtifactsToDesigner(jobId: string, payload: any): Promise<any> {
  // Query all artifacts for the job
  const { rows } = await pool.query(
    `
    SELECT id, type, filename, storage_key, mime_type, metadata, role
    FROM artifacts
    WHERE job_id = $1
    ORDER BY created_at ASC
    `,
    [jobId]
  );

  // Phase 8.4.3: Attach artifacts array for Designer's new schema
  return {
    ...payload,
    artifacts: rows,
  };
}

/**
 * Enqueue tasks that are READY (PENDING + deps satisfied)
 */
export async function enqueueReadyTasks(jobId: string) {
  const { rows } = await pool.query(
    `
    SELECT t.id, t.agent_type, t.payload, t.parent_task_id
    FROM tasks t
    LEFT JOIN tasks p ON t.parent_task_id = p.id
    WHERE t.job_id = $1
      AND t.status = 'PENDING'
      AND (t.parent_task_id IS NULL OR p.status = 'SUCCESS')
    ORDER BY t.order_index ASC
    `,
    [jobId]
  );

  for (const row of rows) {
    // Skip tasks that don't have agent_type set
    if (!row.agent_type) {
      console.warn(`[ORCHESTRATOR] Skipping task ${row.id} with NULL agent_type`);
      continue;
    }

    let payload = row.payload;
    if (typeof payload === 'string') {
      payload = JSON.parse(payload);
    }

    // Check if template dependencies are satisfied BEFORE resolving inputs
    // This ensures we don't try to resolve {{tasks.X.outputs.Y}} when X hasn't completed
    const { satisfied: depsSatisfied, missing } = await areTemplateDependenciesSatisfied(
      jobId, 
      payload, 
      row.parent_task_id
    );
    
    if (!depsSatisfied) {
      console.log(`[ORCHESTRATOR] Task ${row.id} waiting for dependencies: ${missing.join(', ')}`);
      continue; // Skip this task, will be retried when dependencies complete
    }

    // Resolve dynamic inputs
    try {
      payload = await resolveTaskInputs(jobId, row.id, row.parent_task_id, payload);
    } catch (err: any) {
      console.error(`Failed to resolve inputs for task ${row.id}:`, err);
      await pool.query(
        `UPDATE tasks SET status = 'FAILED', result = $1 WHERE id = $2`,
        [JSON.stringify({ error: `Input resolution failed: ${err.message}` }), row.id]
      );
      continue;
    }

    // Phase 8.4.3: Attach artifact metadata to Designer tasks
    if (row.agent_type === 'designer') {
      try {
        // Phase 8.4.3: Attach artifacts array for new schema
        const enhancedPayload = await attachArtifactsToDesigner(jobId, payload);
        payload = enhancedPayload; // keep as object
      } catch (error: any) {
        // Phase 8.4.6: Fail task early with clear error
        console.error(`Failed to attach artifacts for task ${row.id}:`, error.message);
        await pool.query(
          `UPDATE tasks SET status = 'FAILED', result = $1 WHERE id = $2`,
          [JSON.stringify({ error: error.message }), row.id]
        );
        continue; // Skip enqueueing this task
      }
    }

    // Small delay to ensure database transaction is fully committed
    await setTimeout(100);

    await enqueueTask(row.id, {
      job_id: jobId,
      agent_type: row.agent_type,
      payload: payload
    });
  }
}

/**
 * Create a reviewer task for a completed executor task
 */
async function createReviewerTask(task: any) {
  const reviewerName = `Review ${task.name}`;

  await pool.query(
    `
    INSERT INTO tasks (
      id,
      job_id,
      name,
      status,
      parent_task_id,
      order_index,
      agent_type,
      payload
    )
    VALUES (
      gen_random_uuid(),
      $1,
      $2,
      'PENDING',
      $3,
      $4,
      'reviewer',
      $5
    )
    `,
    [
      task.job_id,
      reviewerName,
      task.id,
      task.order_index + 1,
      JSON.stringify({
        target_task_id: task.id,
        score_threshold: 80,
      }),
    ]
  );
}

/**
 * Handle task completion (SUCCESS)
 * This is now reviewer-aware
 */
export async function handleTaskCompletion(taskId: string) {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      job_id,
      name,
      agent_type,
      parent_task_id,
      order_index,
      retry_count,
      review_decision
    FROM tasks
    WHERE id = $1
    `,
    [taskId]
  );

  if (!rows.length) return;

  const task = rows[0];

  /**
   * --------------------------------------------------
   * 1️⃣ Reviewer task completed
   * --------------------------------------------------
   */
  if (task.agent_type === "reviewer") {
    const targetTaskId =
      (await pool.query(
        `
        SELECT payload->>'target_task_id' AS target
        FROM tasks
        WHERE id = $1
        `,
        [taskId]
      )).rows[0]?.target;

    if (!targetTaskId) return;

    if (task.review_decision === "APPROVE") {
      // ✅ Review passed → continue DAG
      await enqueueReadyTasks(task.job_id);
      return;
    }

    // ❌ Review rejected → retry or fail original task
    const { rows: targetRows } = await pool.query(
      `
      SELECT retry_count
      FROM tasks
      WHERE id = $1
      `,
      [targetTaskId]
    );

    if (!targetRows.length) return;

    const retries = targetRows[0].retry_count;

    if (retries < 3) {
      await pool.query(
        `
        UPDATE tasks
        SET status = 'PENDING'
        WHERE id = $1
        `,
        [targetTaskId]
      );
    } else {
      // Exceeded retries → let existing DLQ logic take over
      await pool.query(
        `
        UPDATE tasks
        SET status = 'FAILED'
        WHERE id = $1
        `,
        [targetTaskId]
      );
    }

    await enqueueReadyTasks(task.job_id);
    return;
  }

  /**
   * --------------------------------------------------
   * 2️⃣ Normal executor task completed
   * --------------------------------------------------
   */

  // Check if this task already has a reviewer
  const { rows: existingReviews } = await pool.query(
    `
    SELECT id
    FROM tasks
    WHERE parent_task_id = $1
      AND agent_type = 'reviewer'
    `,
    [task.id]
  );

  if (existingReviews.length === 0) {
    // 🔍 Insert reviewer task
    await createReviewerTask(task);

    await pool.query(
      `
      UPDATE jobs
      SET status = 'RUNNING'
      WHERE id = $1 AND status = 'SUCCESS'
      `,
      [task.job_id]
    );

    // enqueue the reviewer immediately
    await enqueueReadyTasks(task.job_id);
    return;
  }

  /**
   * --------------------------------------------------
   * 3️⃣ No review needed → continue DAG
   * --------------------------------------------------
   */
  await enqueueReadyTasks(task.job_id);
}
