import { Router } from "express";
import { AuthRequest } from "./auth";
import pool from "./db";
import { transitionTask } from "./stateMachine";
import { assertTaskOwnership } from "./ownership";
import { enqueueReadyTasks, handleTaskCompletion } from "./orchestrator";

const router = Router();

/**
 * POST /api/tasks/:taskId/retry
 */
router.post("/:taskId/retry", async (req: AuthRequest, res) => {
  const { taskId } = req.params;

  try {
    await assertTaskOwnership(taskId, req.user!.id);

    await pool.query(
      `
      UPDATE tasks
      SET
        retry_count = retry_count + 1,
        status = 'PENDING',
        started_at = NULL,
        finished_at = NULL
      WHERE id = $1
      `,
      [taskId]
    );

    const { rows } = await pool.query(
      `SELECT job_id FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Task not found" });
    }

    await enqueueReadyTasks(rows[0].job_id);

    res.json({ ok: true });
  } catch (err: any) {
    res
      .status(err.status || 500)
      .json({ error: err.message });
  }
});

/**
 * POST /api/tasks/:taskId/skip
 */
router.post("/:taskId/skip", async (req: AuthRequest, res) => {
  const { taskId } = req.params;

  try {
    await assertTaskOwnership(taskId, req.user!.id);

    await transitionTask(taskId, "SKIPPED", {
      reason: "manual_skip",
    });

    const { rows } = await pool.query(
      `SELECT job_id FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (rows.length) {
      await enqueueReadyTasks(rows[0].job_id);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/tasks/:taskId/fail
 */
router.post("/:taskId/fail", async (req: AuthRequest, res) => {
  const { taskId } = req.params;

  try {
    await assertTaskOwnership(taskId, req.user!.id);

    await transitionTask(taskId, "FAILED", {
      reason: "manual_fail",
    });

    const { rows } = await pool.query(
      `SELECT job_id FROM tasks WHERE id = $1`,
      [taskId]
    );

    if (rows.length) {
      await enqueueReadyTasks(rows[0].job_id);
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/tasks/:taskId/review
 */
router.post("/:taskId/review", async (req: AuthRequest, res) => {
  const { taskId } = req.params;
  const { score, decision, feedback } = req.body;

  if (typeof score !== "number" || !["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({ error: "Invalid review payload" });
  }

  try {
    await assertTaskOwnership(taskId, req.user!.id);

    await pool.query(
      `
      UPDATE tasks
      SET
        review_score = $2,
        review_decision = $3,
        review_feedback = $4
      WHERE id = $1
      `,
      [taskId, score, decision, feedback || null]
    );

    if (decision === "APPROVE") {
      await transitionTask(taskId, "SUCCESS", { review: "approved" });
    } else {
      await transitionTask(taskId, "FAILED", { review: "rejected" });
    }

    await handleTaskCompletion(taskId);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
