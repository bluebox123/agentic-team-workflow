import { Router, Request, Response } from "express";
import pool from "../db";
import { diffArtifacts } from "./diff";
import { 
  promoteArtifact, 
  getArtifactStatusHistory, 
  getFrozenArtifacts,
  checkPromotionPermission,
  PromotionRequest,
  ArtifactStatus 
} from "./promotion";
import { AuthRequest } from "../auth";

const router = Router();

/**
 * POST /api/jobs/:jobId/generate-report-pdf
 * Enqueue a designer task to generate a LaTeX/Tectonic PDF artifact.
 */
router.post("/jobs/:jobId/generate-report-pdf", async (req: AuthRequest, res: Response) => {
  const { jobId } = req.params;
  const { title, sections, style } = req.body || {};

  if (!Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: "sections must be a non-empty array" });
  }

  try {
    const maxOrder = await pool.query(
      `SELECT COALESCE(MAX(order_index), -1) AS max_order FROM tasks WHERE job_id = $1`,
      [jobId]
    );
    const nextOrder = Number(maxOrder.rows[0]?.max_order ?? -1) + 1;

    const payload = {
      title: typeof title === "string" && title.trim() ? title.trim() : "Generated Report",
      sections,
      style: typeof style === "object" && style ? style : {},
    };

    const inserted = await pool.query(
      `
      INSERT INTO tasks (job_id, name, agent_type, payload, status, order_index, created_at)
      VALUES ($1, $2, $3, $4, 'PENDING', $5, NOW())
      RETURNING id
      `,
      [jobId, "Generate Report PDF", "designer", payload, nextOrder]
    );

    res.json({ ok: true, task_id: inserted.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs/:jobId/artifacts
 */
router.get("/jobs/:jobId/artifacts", async (req, res) => {
  const { jobId } = req.params;

  const { rows } = await pool.query(
    `
    SELECT
      id,
      task_id,
      type,
      filename,
      storage_key,
      mime_type,
      previewable,
      role,
      status,
      frozen_at,
      promoted_from,
      created_at
    FROM artifacts
    WHERE job_id = $1
    ORDER BY created_at ASC
    `,
    [jobId]
  );

  res.json(rows);
});

/**
 * Phase 8.5.3: GET /api/artifacts/:id/diff?from=<version>&to=<version>
 * Compare two versions of the same artifact
 */
router.get("/artifacts/:id/diff", async (req, res) => {
  const { id } = req.params;
  const { from, to, against } = req.query;

  try {
    // Support both ?from=&to= and ?against= formats
    let fromVersion: string;
    let toVersion: string;

    if (from && to) {
      fromVersion = from as string;
      toVersion = to as string;
    } else if (against) {
      // Default: compare current version with specified version
      fromVersion = against as string;
      toVersion = "current";
    } else {
      return res.status(400).json({
        error: "Missing query parameters. Use ?from=<v1>&to=<v2> or ?against=<v1>"
      });
    }

    // Get the base artifact to find job_id, type, role
    const baseResult = await pool.query(
      `SELECT job_id, type, role FROM artifacts WHERE id = $1`,
      [id]
    );

    if (baseResult.rows.length === 0) {
      return res.status(404).json({ error: "Artifact not found" });
    }

    const { job_id, type, role } = baseResult.rows[0];

    // Get the two artifact versions to compare
    let fromQuery, toQuery;
    let fromParams, toParams;

    if (fromVersion === "current") {
      fromQuery = `
        SELECT * FROM artifacts 
        WHERE job_id = $1 AND type = $2 AND (role = $3 OR (role IS NULL AND $3 IS NULL))
          AND is_current = TRUE
      `;
      fromParams = [job_id, type, role];
    } else {
      fromQuery = `
        SELECT * FROM artifacts 
        WHERE job_id = $1 AND type = $2 AND (role = $3 OR (role IS NULL AND $3 IS NULL))
          AND version = $4
      `;
      fromParams = [job_id, type, role, fromVersion];
    }

    if (toVersion === "current") {
      toQuery = `
        SELECT * FROM artifacts 
        WHERE job_id = $1 AND type = $2 AND (role = $3 OR (role IS NULL AND $3 IS NULL))
          AND is_current = TRUE
      `;
      toParams = [job_id, type, role];
    } else {
      toQuery = `
        SELECT * FROM artifacts 
        WHERE job_id = $1 AND type = $2 AND (role = $3 OR (role IS NULL AND $3 IS NULL))
          AND version = $4
      `;
      toParams = [job_id, type, role, toVersion];
    }

    const [fromResult, toResult] = await Promise.all([
      pool.query(fromQuery, fromParams),
      pool.query(toQuery, toParams)
    ]);

    if (fromResult.rows.length === 0) {
      return res.status(404).json({ 
        error: `Version ${fromVersion} not found for artifact ${type}:${role || 'null'}` 
      });
    }

    if (toResult.rows.length === 0) {
      return res.status(404).json({ 
        error: `Version ${toVersion} not found for artifact ${type}:${role || 'null'}` 
      });
    }

    // Generate diff
    const diff = diffArtifacts(fromResult.rows[0], toResult.rows[0]);

    res.json(diff);

  } catch (error: any) {
    console.error("Diff error:", error);
    res.status(500).json({ 
      error: error.message || "Internal server error during diff calculation" 
    });
  }
});

/**
 * Phase 8.5.3: GET /api/artifacts/versions/:jobId/:type/:role
 * Get all versions of a specific artifact (job, type, role)
 */
router.get("/artifacts/versions/:jobId/:type/:role?", async (req, res) => {
  const { jobId, type, role } = req.params;

  try {
    const query = `
      SELECT 
        id, version, is_current, parent_artifact_id,
        filename, created_at, metadata
      FROM artifacts
      WHERE job_id = $1 
        AND type = $2 
        AND (role = $3 OR (role IS NULL AND $3 IS NULL))
      ORDER BY version ASC
    `;

    const { rows } = await pool.query(query, [jobId, type, role || null]);

    res.json({
      job_id: jobId,
      type,
      role: role || null,
      versions: rows,
      total_versions: rows.length
    });

  } catch (error: any) {
    console.error("Versions query error:", error);
    res.status(500).json({ 
      error: error.message || "Internal server error" 
    });
  }
});

/**
 * Phase 8.6.2: POST /api/artifacts/:id/promote
 * Promote artifact to next lifecycle stage
 */
router.post("/artifacts/:id/promote", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { target_status } = req.body as PromotionRequest;
  const userId = req.user?.id; // Now properly typed

  try {
    // Validate target status
    if (!['approved', 'frozen'].includes(target_status)) {
      return res.status(400).json({
        error: "Invalid target_status. Must be 'approved' or 'frozen'"
      });
    }

    // Check permissions
    const hasPermission = await checkPromotionPermission(userId!, id, target_status);
    if (!hasPermission) {
      return res.status(403).json({
        error: "Insufficient permissions to promote this artifact"
      });
    }

    const result = await promoteArtifact(id, { target_status }, userId!);

    res.json({
      success: true,
      message: `Artifact promoted to ${target_status}`,
      promotion: result
    });

  } catch (error: any) {
    console.error("Promotion error:", error);
    res.status(400).json({
      error: error.message || "Failed to promote artifact"
    });
  }
});

/**
 * Phase 8.6.2: GET /api/artifacts/:id/status-history
 * Get promotion history for an artifact
 */
router.get("/artifacts/:id/status-history", async (req, res) => {
  const { id } = req.params;

  try {
    const history = await getArtifactStatusHistory(id);
    res.json(history);
  } catch (error: any) {
    console.error("Status history error:", error);
    res.status(500).json({
      error: error.message || "Failed to get status history"
    });
  }
});

/**
 * Phase 8.6.2: GET /api/jobs/:jobId/frozen-artifacts
 * Get all frozen artifacts for a job
 */
router.get("/jobs/:jobId/frozen-artifacts", async (req, res) => {
  const { jobId } = req.params;

  try {
    const frozenArtifacts = await getFrozenArtifacts(jobId);
    res.json({
      job_id: jobId,
      frozen_artifacts: frozenArtifacts,
      total: frozenArtifacts.length
    });
  } catch (error: any) {
    console.error("Frozen artifacts error:", error);
    res.status(500).json({
      error: error.message || "Failed to get frozen artifacts"
    });
  }
});

export default router;
