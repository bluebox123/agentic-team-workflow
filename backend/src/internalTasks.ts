// backend/src/internalTasks.ts
import { Router } from "express";
import pool from "./db";
import { transitionTask } from "./stateMachine";
import { handleTaskCompletion } from "./orchestrator";
import { sendToDLQ } from "./mq";
import { createArtifact } from "./artifacts/createArtifact";
import { promoteArtifact } from "./artifacts/promotion";

const router = Router();

/**
 * Worker requests permission to start task
 */
router.post("/tasks/:id/start", async (req, res) => {
  const { id } = req.params;

  try {
    await transitionTask(id, "RUNNING", { source: "worker" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

/**
 * Worker reports success
 */
router.post("/tasks/:id/complete", async (req, res) => {
  const { id } = req.params;
  const { result, artifact, effects } = req.body;

  try {
    await pool.query(
      `UPDATE tasks SET result = $1 WHERE id = $2`,
      [result ?? {}, id]
    );

    // ✅ NEW: persist artifact if present
    if (artifact) {
      await createArtifact({
        task_id: id,
        job_id: result?.job_id,
        type: artifact.type,
        filename: artifact.filename,
        storage_key: artifact.storage_key,
        metadata: artifact.metadata,
        role: artifact.role, // Phase 8.4.2: Pass role to artifact creation
      });
    }

    // Phase 8.6.4: Handle reviewer effects (artifact promotion)
    if (effects && effects.artifact_promote) {
      const { artifact_promote } = effects;
      
      // Get the most recent artifact for this task
      const { rows } = await pool.query(
        `
        SELECT id 
        FROM artifacts 
        WHERE task_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1
        `,
        [id]
      );

      if (rows.length > 0) {
        const artifactId = rows[0].id;
        const reviewerId = result?.reviewer_id || 'system';

        try {
          await promoteArtifact(artifactId, { 
            target_status: artifact_promote 
          }, reviewerId);

          console.log(`[REVIEWER] Auto-promoted artifact ${artifactId} to ${artifact_promote}`);
        } catch (error: any) {
          console.error(`[REVIEWER] Failed to promote artifact:`, error.message);
          // Don't fail the task completion, just log the error
        }
      }
    }

    await transitionTask(id, "SUCCESS", { source: "worker" });

    // 🔓 Unlock dependent tasks
    await handleTaskCompletion(id);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/tasks/:id/review", async (req, res) => {
  const { id } = req.params;
  const { score, decision, feedback } = req.body;

  if (typeof score !== "number" || !["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({ error: "Invalid review payload" });
  }

  try {
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
      await transitionTask(id, "SUCCESS", { review: "approved", source: "worker" });
    } else {
      await transitionTask(id, "FAILED", { review: "rejected", source: "worker" });
    }

    await handleTaskCompletion(id);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Worker reports failure
 */
router.post("/tasks/:id/fail", async (req, res) => {
  const { id } = req.params;
  const { error } = req.body;

  try {
    await pool.query(
      `UPDATE tasks SET result = $1 WHERE id = $2`,
      [{ error }, id]
    );

    await transitionTask(id, "FAILED", { source: "worker", error });

    // Push a copy of the failed task into the DLQ for inspection/recovery
    await sendToDLQ(id, { error });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
