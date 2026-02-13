import { Router } from "express";
import pool from "./db";
import { AuthRequest } from "./auth";
import { assertTaskOwnership } from "./ownership";

const router = Router();

router.get(
  "/tasks/:taskId/logs",
  async (req: AuthRequest, res) => {
    const { taskId } = req.params;

    try {
      await assertTaskOwnership(taskId, req.user!.id);

      const { rows } = await pool.query(
        `
        SELECT level, message, created_at
        FROM task_logs
        WHERE task_id = $1
        ORDER BY created_at ASC
        `,
        [taskId]
      );

      res.json(rows);
    } catch (err: any) {
      res
        .status(err.status || 500)
        .json({ error: err.message });
    }
  }
);

export default router;
