import { Router } from "express";
import pool from "../db";
import { getObjectStream } from "../storage";

const router = Router();

/**
 * GET /api/artifacts/:id/download
 */
router.get("/artifacts/:id/download", async (req, res) => {
  const { id } = req.params;

  const { rows } = await pool.query(
    `
    SELECT filename, storage_key, mime_type, previewable
    FROM artifacts
    WHERE id = $1
    `,
    [id]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "Artifact not found" });
  }

  const { filename, storage_key, mime_type, previewable } = rows[0];

  // Set all required headers
  res.setHeader("Content-Type", mime_type);
  res.setHeader(
    "Content-Disposition",
    `${previewable ? "inline" : "attachment"}; filename="${filename}"`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");

  const stream = await getObjectStream(storage_key);
  stream.pipe(res);
});

export default router;
