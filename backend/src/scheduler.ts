import pool from "./db";
import { enqueueTask } from "./mq";
import { enqueueReadyTasks } from "./orchestrator";
import parseExpression from "cron-parser";
import { transitionTask } from "./stateMachine";

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_TASKS || 2);
const STALE_RUNNING_TASK_MINUTES = Number(
  process.env.STALE_RUNNING_TASK_MINUTES || 30
);

export function startScheduler(intervalMs = 500) {
  console.log("[SCHEDULER] started - v2");

  setInterval(async () => {
    try {
      /**
       * -------------------------------------------------
       * 1️⃣ SCHEDULED JOBS SCAN
       * -------------------------------------------------
       * Unlock jobs whose scheduled time has arrived
       */
      const dueSchedules = await pool.query(
        `
        SELECT js.id, js.job_id, js.type, js.cron_expr
        FROM job_schedules js
        JOIN jobs j ON js.job_id = j.id
        WHERE js.enabled = true
          AND js.next_run_at IS NOT NULL
          AND js.next_run_at <= NOW()
          AND j.status = 'SCHEDULED'
        FOR UPDATE SKIP LOCKED
        `
      );

      for (const row of dueSchedules.rows) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // Load schedule details
          const { rows: scheduleRows } = await client.query(
            `
            SELECT type, cron_expr
            FROM job_schedules
            WHERE id = $1
            FOR UPDATE
            `,
            [row.id]
          );

          const schedule = scheduleRows[0];

          let nextRunAt: Date | null = null;

          if (schedule.type === "cron") {
            const interval = parseExpression.parse(schedule.cron_expr);
            nextRunAt = interval.next().toDate();
          }

          // Update schedule
          await client.query(
            `
            UPDATE job_schedules
            SET
              last_run_at = NOW(),
              next_run_at = $1,
              updated_at = NOW()
            WHERE id = $2
            `,
            [nextRunAt, row.id]
          );

          // Move job back to scheduled if cron
          await client.query(
            `
            UPDATE jobs
            SET status = $2
            WHERE id = $1
            `,
            [
              row.job_id,
              schedule.type === "cron" ? "SCHEDULED" : "RUNNING",
            ]
          );

          await client.query("COMMIT");

          // 🚀 Let existing orchestration logic take over
          await enqueueReadyTasks(row.job_id);

          console.log("[SCHEDULER] unlocked scheduled job", row.job_id);
        } catch (err) {
          await client.query("ROLLBACK");
          console.error("[SCHEDULER] failed to unlock job", row.job_id, err);
        } finally {
          client.release();
        }
      }

      /**
       * -------------------------------------------------
       * 2️⃣ EXISTING TASK SCHEDULING (UNCHANGED)
       * -------------------------------------------------
       */

      const { rows: staleRunning } = await pool.query(
        `
        SELECT id
        FROM tasks
        WHERE status = 'RUNNING'
          AND started_at IS NOT NULL
          AND started_at < NOW() - ($1 * INTERVAL '1 minute')
        `,
        [STALE_RUNNING_TASK_MINUTES]
      );

      for (const row of staleRunning) {
        try {
          await transitionTask(row.id, "FAILED", { reason: "stale_timeout" });
        } catch (e) {
          console.error("[SCHEDULER] failed to timeout stale task", row.id, e);
        }
      }

      // Global concurrency guard
      const running = await pool.query(
        `
        SELECT COUNT(*)
        FROM tasks
        WHERE status = 'RUNNING'
          AND (
            started_at IS NULL
            OR started_at >= NOW() - ($1 * INTERVAL '1 minute')
          )
        `,
        [STALE_RUNNING_TASK_MINUTES]
      );

      if (Number(running.rows[0].count) >= MAX_CONCURRENT) {
        return;
      }

      // Find READY tasks whose jobs are not paused/cancelled
      const { rows } = await pool.query(`
        SELECT DISTINCT t.job_id
        FROM tasks t
        JOIN jobs j ON t.job_id = j.id
        LEFT JOIN tasks p ON t.parent_task_id = p.id
        WHERE t.status = 'PENDING'
          AND j.status NOT IN ('PAUSED','CANCELLED')
          AND (t.parent_task_id IS NULL OR p.status = 'SUCCESS')
      `);

      for (const row of rows) {
        await enqueueReadyTasks(row.job_id);
      }

      /**
       * -------------------------------------------------
       * 4️⃣ CLEANUP OLD JOBS (RETENTION POLICY)
       * -------------------------------------------------
       * Delete jobs older than 7 days to free up storage
       */
      const RETENTION_DAYS = 7;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1. Identify jobs to delete (older than 7 days, terminal status)
        const { rows: jobsToDelete } = await client.query(
          `
            SELECT id FROM jobs 
            WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
              AND status IN ('SUCCESS', 'FAILED', 'CANCELLED')
            FOR UPDATE
          `,
          [RETENTION_DAYS]
        );

        if (jobsToDelete.length > 0) {
          const jobIds = jobsToDelete.map((j) => j.id);

          // 2. Delete task_logs for tasks of these jobs (using job_id directly)
          await client.query(
            `
            DELETE FROM task_logs
            WHERE task_id IN (
              SELECT id FROM tasks WHERE job_id = ANY($1)
            )
            `,
            [jobIds]
          );

          // 3. Delete outputs for tasks of these jobs
          await client.query(
            `
            DELETE FROM outputs
            WHERE task_id IN (
              SELECT id FROM tasks WHERE job_id = ANY($1)
            )
            `,
            [jobIds]
          );

          // 4. Delete artifacts for tasks of these jobs
          await client.query(
            `
            DELETE FROM artifacts
            WHERE task_id IN (
              SELECT id FROM tasks WHERE job_id = ANY($1)
            )
            `,
            [jobIds]
          );

          // 5. Delete tasks
          await client.query(
            `
            DELETE FROM tasks
            WHERE job_id = ANY($1)
            `,
            [jobIds]
          );

          // 6. Delete job_schedules
          await client.query(
            `
            DELETE FROM job_schedules
            WHERE job_id = ANY($1)
            `,
            [jobIds]
          );

          // 7. Finally delete the jobs
          await client.query(
            `
            DELETE FROM jobs
            WHERE id = ANY($1)
            `,
            [jobIds]
          );

          console.log(`[SCHEDULER] Cleaned up ${jobsToDelete.length} old jobs`);
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[SCHEDULER] Failed to clean up old jobs:", err);
      } finally {
        client.release();
      }

    } catch (err) {
      console.error("[SCHEDULER ERROR]", err);
    }
  }, intervalMs);
}
