// backend/src/tasks.ts
import { Router } from "express";
import pool from "./db";
import { transitionTask } from "./stateMachine";

const router = Router();

/**
 * GET /api/jobs/:jobId/tasks
 */
router.get("/jobs/:jobId/tasks", async (req, res) => {
  const { jobId } = req.params;

  const { rows } = await pool.query(
    `
    SELECT
      id,
      name,
      status,
      retry_count,
      started_at,
      finished_at,
      review_score,
      review_decision
    FROM tasks
    WHERE job_id = $1
    ORDER BY created_at ASC
    `,
    [jobId]
  );

  res.json(rows);
});

/**
 * POST /api/tasks/:id/retry
 */
router.post("/tasks/:id/retry", async (req, res) => {
  const { id } = req.params;

  await pool.query(
    `UPDATE tasks SET retry_count = retry_count + 1 WHERE id = $1`,
    [id]
  );

  await transitionTask(id, "QUEUED", { manual: true });

  res.json({ ok: true });
});

/**
 * POST /api/tasks/:id/skip
 */
router.post("/tasks/:id/skip", async (req, res) => {
  const { id } = req.params;

  await transitionTask(id, "SKIPPED", { manual: true });

  res.json({ ok: true });
});

/**
 * POST /api/tasks/:id/fail
 */
router.post("/tasks/:id/fail", async (req, res) => {
  const { id } = req.params;

  await transitionTask(id, "FAILED", { manual: true });

  res.json({ ok: true });
});

/**
 * POST /api/tasks/:id/review
 * Reviewer submits verdict
 */
router.post("/tasks/:id/review", async (req, res) => {
  const { id } = req.params;
  const { score, decision, feedback } = req.body;

  if (
    typeof score !== "number" ||
    !["APPROVE", "REJECT"].includes(decision)
  ) {
    return res.status(400).json({ error: "Invalid review payload" });
  }

  await pool.query(
    `
    UPDATE tasks
    SET
      review_score = $2,
      review_decision = $3,
      review_feedback = $4
    WHERE id = $1
    `,
    [id, score, decision, feedback || null]
  );

  if (decision === "APPROVE") {
    await transitionTask(id, "SUCCESS", { review: "approved" });
  } else {
    await transitionTask(id, "FAILED", { review: "rejected" });
  }

  res.json({ ok: true });
});

export default router;
