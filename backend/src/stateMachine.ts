// backend/src/stateMachine.ts
import pool from "./db";
import { emitEvent } from "./socket";
import { tasksStateTotal } from "./metrics";

export type TaskState =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED";

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  PENDING: ["QUEUED", "CANCELLED", "SKIPPED", "FAILED"],
  QUEUED: ["RUNNING", "CANCELLED", "SKIPPED", "FAILED"],
  RUNNING: ["SUCCESS", "FAILED", "CANCELLED", "SKIPPED"],
  FAILED: ["QUEUED", "CANCELLED"],
  SUCCESS: [],
  SKIPPED: [],
  CANCELLED: [],
};

export async function transitionTask(
  taskId: string,
  nextState: TaskState,
  meta: Record<string, any> = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const res = await client.query(
      "SELECT status FROM tasks WHERE id = $1 FOR UPDATE",
      [taskId]
    );

    if (res.rows.length === 0) {
      throw new Error(`Task ${taskId} not found`);
    }

    const currentState = res.rows[0].status as TaskState;
    const allowed = TASK_TRANSITIONS[currentState] || [];

    if (!allowed.includes(nextState)) {
      throw new Error(
        `Illegal task transition: ${currentState} → ${nextState}`
      );
    }

    const fields: string[] = ["status = $1"];
    const values: any[] = [nextState, taskId];

    if (nextState === "RUNNING") {
      fields.push("started_at = NOW()");
    }

    if (["SUCCESS", "FAILED", "CANCELLED", "SKIPPED"].includes(nextState)) {
      fields.push("finished_at = NOW()");
    }

    await client.query(
      `
      UPDATE tasks
      SET ${fields.join(", ")}
      WHERE id = $2
      `,
      values
    );

    await client.query("COMMIT");

    tasksStateTotal.inc({ state: nextState });

    emitEvent("task:update", {
      taskId,
      from: currentState,
      to: nextState,
      meta,
    });

    if (["SUCCESS", "FAILED", "CANCELLED", "SKIPPED"].includes(nextState)) {
      try {
        await finalizeJobForTask(taskId);
      } catch (e) {
        console.error("[JOB FINALIZE] error:", (e as Error).message);
      }
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
export async function canTransition(
  current: TaskState,
  next: TaskState
): Promise<boolean> {
  const allowed = TASK_TRANSITIONS[current] || [];
  return allowed.includes(next);
}

async function finalizeJobForTask(taskId: string) {
  const { rows: jobRows } = await pool.query(
    `SELECT job_id FROM tasks WHERE id = $1`,
    [taskId]
  );

  if (!jobRows.length) return;
  const jobId = jobRows[0].job_id as string;

  const { rows } = await pool.query(
    `
    SELECT
      SUM(CASE WHEN status IN ('PENDING','QUEUED','RUNNING') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status IN ('FAILED','CANCELLED') THEN 1 ELSE 0 END) AS failed,
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('SUCCESS','FAILED','CANCELLED','SKIPPED') THEN 1 ELSE 0 END) AS terminal
    FROM tasks
    WHERE job_id = $1
    `,
    [jobId]
  );

  const agg = rows[0] as any;
  const active = Number(agg.active || 0);
  const failed = Number(agg.failed || 0);
  const total = Number(agg.total || 0);
  const terminal = Number(agg.terminal || 0);

  if (total > 0 && active === 0 && terminal === total) {
    const status = failed > 0 ? "FAILED" : "SUCCESS";
    await pool.query(`UPDATE jobs SET status = $2 WHERE id = $1`, [jobId, status]);
    emitEvent("job:update", { jobId, status });
  }
}
