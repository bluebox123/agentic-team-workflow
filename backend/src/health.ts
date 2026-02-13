import { Router } from "express";
import pool from "./db";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      db: "up",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      db: "down",
    });
  }
});

export default router;
