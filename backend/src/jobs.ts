// backend/src/jobs.ts
import { Router } from "express";
import pool from "./db";
import { v4 as uuidv4 } from "uuid";
import { emitEvent } from "./socket";
import { enqueueReadyTasks } from "./orchestrator";
import { AuthRequest } from "./auth";
import { jobsCreatedTotal } from "./metrics";
import parseExpression from "cron-parser";
import { assertJobOwnership } from "./ownership";
import { getDefaultOrgId } from "./orgs";
import { requireOrgRole } from "./orgAccess";



const router = Router();

/**
 * GET /api/jobs
 * List jobs owned by the authenticated user
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    const scope = (req.query.scope as string) || "mine";
    const userId = req.user!.id;
    const orgId = req.user!.orgId;
    let rows;

    if (scope === "mine") {
      const result = await pool.query(
        `
        SELECT 
          j.id, 
          j.title, 
          j.status, 
          j.created_at,
          j.template_id,
          j.template_version,
          wt.name AS template_name
        FROM jobs j
        LEFT JOIN workflow_templates wt
          ON j.template_id = wt.id
        WHERE j.user_id = $1
        ORDER BY j.created_at DESC
        `,
        [userId]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `
        SELECT 
          j.id, 
          j.title, 
          j.status, 
          j.created_at,
          j.template_id,
          j.template_version,
          wt.name AS template_name
        FROM jobs j
        LEFT JOIN workflow_templates wt
          ON j.template_id = wt.id
        WHERE
          (
            -- Legacy personal jobs: only visible to owner
            (j.organization_id IS NULL AND j.user_id = $1)
            OR
            -- Org jobs: visible via user_id relationship or specific orgId claim
            j.organization_id IN (
              SELECT organization_id
              FROM organization_members
              WHERE user_id = $1
            )
            OR
            -- Explicit trust for the orgId in the JWT
            (j.organization_id = $2)
          )
        ORDER BY j.created_at DESC
        `,
        [userId, orgId || null]
      );
      rows = result.rows;
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

/**
 * POST /api/jobs
 * Create a job (DAG supported)
 */
router.post("/", async (req: AuthRequest, res) => {
  const { title, tasks } = req.body;

  if (!title || !Array.isArray(tasks)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const client = await pool.connect();
  const taskIds: string[] = [];
  let jobId: string;

  try {
    await client.query("BEGIN");

    jobId = uuidv4();
    const orgId = await getDefaultOrgId(req.user!.id);

    // 🔐 Job belongs to authenticated user and their org
    await client.query(
      `
      INSERT INTO jobs (id, user_id, organization_id, title, status)
      VALUES ($1, $2, $3, $4, 'RUNNING')
      `,
      [jobId, req.user!.id, orgId, title]
    );

    // Create tasks
    for (let i = 0; i < tasks.length; i++) {
      const taskId = uuidv4();
      taskIds.push(taskId);

      const parentIndex = tasks[i].parent_task_index;
      const parentTaskId =
        typeof parentIndex === "number" ? taskIds[parentIndex] : null;

      // Build payload - inject target_task_id for reviewers
      let payload = tasks[i].payload || {};
      if (tasks[i].agent_type === 'reviewer' && parentTaskId) {
        payload = { ...payload, target_task_id: parentTaskId };
      }

      await client.query(
        `
        INSERT INTO tasks (
          id, job_id, name, status,
          parent_task_id, order_index, agent_type, payload
        )
        VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7)
        `,
        [
          taskId,
          jobId,
          tasks[i].name,
          parentTaskId,
          i,
          tasks[i].agent_type || 'executor',
          JSON.stringify(payload),
        ]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Failed to create job" });
  } finally {
    client.release();
  }

  // 🚀 enqueue root tasks
  await enqueueReadyTasks(jobId);

  emitEvent("job.created", { jobId });

  jobsCreatedTotal.inc();

  res.status(201).json({
    jobId,
    taskCount: taskIds.length,
  });
});

/**
 * POST /api/jobs/:jobId/cancel
 * Only owner can cancel
 */
router.post("/:jobId/cancel", async (req: AuthRequest, res) => {
  const { jobId } = req.params;

  const { rows } = await pool.query(
    `SELECT organization_id FROM jobs WHERE id = $1`,
    [jobId]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Job not found" });
  }

  const orgId = rows[0].organization_id;

  if (orgId) {
    await requireOrgRole(req.user!.id, orgId, ["OWNER", "ADMIN"]);
  }

  const { rowCount } = await pool.query(
    `
    UPDATE jobs
    SET status = 'CANCELLED'
    WHERE id = $1
    `,
    [jobId]
  );

  if (rowCount === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  await pool.query(
    `
    UPDATE tasks
    SET status = 'CANCELLED', finished_at = NOW()
    WHERE job_id = $1
      AND status NOT IN ('SUCCESS','FAILED','CANCELLED','SKIPPED')
    `,
    [jobId]
  );

  res.json({ ok: true });
});

/**
 * POST /api/jobs/:jobId/pause
 */
router.post("/:jobId/pause", async (req: AuthRequest, res) => {
  const { jobId } = req.params;

  const { rowCount } = await pool.query(
    `
    UPDATE jobs
    SET status = 'PAUSED'
    WHERE id = $1 AND user_id = $2
    `,
    [jobId, req.user!.id]
  );

  if (rowCount === 0) {
    return res.status(403).json({ error: "Not authorized" });
  }

  res.json({ ok: true });
});

/**
 * POST /api/jobs/:jobId/resume
 */
router.post("/:jobId/resume", async (req: AuthRequest, res) => {
  const { jobId } = req.params;

  const { rowCount } = await pool.query(
    `
    UPDATE jobs
    SET status = 'RUNNING'
    WHERE id = $1 AND user_id = $2
    `,
    [jobId, req.user!.id]
  );

  if (rowCount === 0) {
    return res.status(403).json({ error: "Not authorized" });
  }

  res.json({ ok: true });
});

/**
 * GET /api/jobs/:jobId/tasks
 */
router.get("/:jobId/tasks", async (req: AuthRequest, res) => {
  const { jobId } = req.params;

  // Verify user owns this job
  const { rows: jobRows } = await pool.query(
    "SELECT id FROM jobs WHERE id = $1 AND user_id = $2",
    [jobId, req.user!.id]
  );

  if (!jobRows.length) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const { rows } = await pool.query(
    `
    SELECT id, name, status, retry_count, started_at, finished_at
    FROM tasks
    WHERE job_id = $1
    ORDER BY created_at ASC
    `,
    [jobId]
  );

  res.json(rows);
});

/**
 * POST /api/jobs/:jobId/schedule
 * Schedule a job for delayed or cron execution
 */
router.post("/:jobId/schedule", async (req: AuthRequest, res) => {
  const { jobId } = req.params;
  const { type, runAt, cron } = req.body;

  if (!type || !["once", "delayed", "cron"].includes(type)) {
    return res.status(400).json({ error: "Invalid schedule type" });
  }

  try {
    // 🔐 ownership check
    await assertJobOwnership(jobId, req.user!.id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock job row
      const { rows } = await client.query(
        `SELECT status FROM jobs WHERE id = $1 FOR UPDATE`,
        [jobId]
      );

      if (!rows.length) {
        throw new Error("Job not found");
      }

      const jobStatus = rows[0].status;

      if (["RUNNING", "CANCELLED"].includes(jobStatus)) {
        return res.status(400).json({
          error: `Cannot schedule a job in ${jobStatus} state`,
        });
      }

      let nextRunAt: Date | null = null;

      if (type === "cron") {
        if (!cron) {
          return res.status(400).json({ error: "Missing cron expression" });
        }

        const interval = parseExpression.parse(cron);
        nextRunAt = interval.next().toDate();
      } else {
        if (!runAt) {
          return res.status(400).json({ error: "Missing runAt timestamp" });
        }

        nextRunAt = new Date(runAt);
        if (isNaN(nextRunAt.getTime())) {
          return res.status(400).json({ error: "Invalid runAt value" });
        }
      }

      // Upsert schedule (one per job)
      await client.query(
        `
        INSERT INTO job_schedules (
          id, job_id, type, cron_expr, run_at, next_run_at
        )
        VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5
        )
        ON CONFLICT (job_id)
        DO UPDATE SET
          type = EXCLUDED.type,
          cron_expr = EXCLUDED.cron_expr,
          run_at = EXCLUDED.run_at,
          next_run_at = EXCLUDED.next_run_at,
          enabled = true,
          updated_at = NOW()
        `,
        [
          jobId,
          type,
          type === "cron" ? cron : null,
          type !== "cron" ? nextRunAt : null,
          nextRunAt,
        ]
      );

      // Move job to scheduled state
      await client.query(
        `UPDATE jobs SET status = 'SCHEDULED' WHERE id = $1`,
        [jobId]
      );

      await client.query("COMMIT");

      res.json({
        ok: true,
        jobId,
        type,
        nextRunAt,
      });
    } catch (err: any) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to schedule job",
    });
  }
});

/**
 * POST /api/jobs/cleanup
 * Stop all running jobs and remove jobs older than 24 hours
 */
router.post("/cleanup", async (req: AuthRequest, res) => {
  const client = await pool.connect();
  let stopped = 0;
  let removed = 0;

  try {
    await client.query("BEGIN");

    // Stop all running jobs
    const stopResult = await client.query(
      `
      UPDATE jobs
      SET status = 'CANCELLED'
      WHERE status = 'RUNNING' AND user_id = $1
      RETURNING id
      `,
      [req.user!.id]
    );
    stopped = stopResult.rowCount || 0;

    // Cancel tasks for stopped jobs
    if (stopped > 0) {
      await client.query(
        `
        UPDATE tasks
        SET status = 'CANCELLED', finished_at = NOW()
        WHERE job_id IN (
          SELECT id FROM jobs WHERE status = 'CANCELLED' AND user_id = $1
        ) AND status NOT IN ('SUCCESS','FAILED','CANCELLED','SKIPPED')
        `,
        [req.user!.id]
      );
    }

    // Remove jobs older than 24 hours (excluding running ones)
    const removeResult = await client.query(
      `
      DELETE FROM jobs
      WHERE user_id = $1 
        AND created_at < NOW() - INTERVAL '24 hours'
        AND status NOT IN ('RUNNING', 'PAUSED', 'SCHEDULED')
      RETURNING id
      `,
      [req.user!.id]
    );
    removed = removeResult.rowCount || 0;

    await client.query("COMMIT");

    res.json({ stopped, removed });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Cleanup error:", err);
    res.status(500).json({ error: "Failed to cleanup jobs" });
  } finally {
    client.release();
  }
});

export default router;
