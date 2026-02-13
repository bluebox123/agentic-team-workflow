import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "./db";
import { AuthRequest } from "./auth";
import { enqueueReadyTasks } from "./orchestrator";
import { getDefaultOrgId } from "./orgs";
import { requireOrgRole } from "./orgAccess";

const router = Router();

function substituteParams(obj: any, params: Record<string, any>): any {
  if (typeof obj === "string") {
    return obj.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in params)) {
        throw new Error(`Missing parameter: ${key}`);
      }
      return String(params[key]);
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(v => substituteParams(v, params));
  }

  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      out[k] = substituteParams(obj[k], params);
    }
    return out;
  }

  return obj;
}

/**
 * POST /api/workflows
 * Create a new workflow template (version 1)
 */
router.post("/", async (req: AuthRequest, res) => {
  const { name, description, dag } = req.body;

  if (!name || !dag || !Array.isArray(dag.tasks) || dag.tasks.length === 0) {
    return res.status(400).json({ error: "Invalid workflow definition" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const templateId = uuidv4();
    const versionId = uuidv4();
    const orgId = await getDefaultOrgId(req.user!.id);

    // 🔐 Role enforcement for template creation
    await requireOrgRole(req.user!.id, orgId, ["OWNER", "ADMIN"]);

    // Create template
    await client.query(
      `
      INSERT INTO workflow_templates (
        id, owner_id, organization_id, name, description
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [templateId, req.user!.id, orgId, name, description || null]
    );

    // Create version v1
    await client.query(
      `
      INSERT INTO workflow_template_versions (
        id, template_id, version, dag
      )
      VALUES ($1, $2, 1, $3)
      `,
      [versionId, templateId, dag]
    );

    await client.query("COMMIT");

    res.status(201).json({
      templateId,
      version: 1,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[WORKFLOW CREATE ERROR]", err);
    res.status(500).json({ error: "Failed to create workflow template" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/workflows/:templateId/run
 * Instantiate a job from a workflow template
 */
router.post("/:templateId/run", async (req: AuthRequest, res) => {
  const { templateId } = req.params;
  const { version, params = {}, title } = req.body;

  if (!version || typeof version !== "number") {
    return res.status(400).json({ error: "Missing or invalid version" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔐 Load template + org role check
    const { rows: templateRows } = await client.query(
      `
      SELECT wt.id, wt.organization_id
      FROM workflow_templates wt
      WHERE wt.id = $1
      `,
      [templateId]
    );

    if (!templateRows.length) {
      return res.status(404).json({ error: "Template not found" });
    }

    const templateOrgId = templateRows[0].organization_id;
    if (templateOrgId) {
      await requireOrgRole(req.user!.id, templateOrgId, ["OWNER", "ADMIN", "MEMBER"]);
    }

    // Load template version
    const { rows: versionRows } = await client.query(
      `
      SELECT dag
      FROM workflow_template_versions
      WHERE template_id = $1 AND version = $2
      `,
      [templateId, version]
    );

    if (!versionRows.length) {
      return res.status(404).json({ error: "Template version not found" });
    }

    const rawDag = versionRows[0].dag;

    // 🔁 Substitute params
    let dag;
    try {
      dag = substituteParams(rawDag, params);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    // Default agent_type to 'executor' with payload {} when omitted
    for (const task of dag.tasks) {
      if (!task.agent_type) {
        task.agent_type = 'executor';
        task.payload = task.payload || {};
      }
    }

    // ---- Job creation (same logic as jobs.ts) ----

    const jobId = uuidv4();
    const taskIds: string[] = [];

    await client.query(
      `
      INSERT INTO jobs (
        id,
        user_id,
        organization_id,
        title,
        status,
        template_id,
        template_version
      )
      VALUES ($1, $2, $3, $4, 'RUNNING', $5, $6)
      `,
      [
        jobId,
        req.user!.id,
        templateOrgId,
        title || `Workflow ${templateId} v${version}`,
        templateId,
        version,
      ]
    );

    for (let i = 0; i < dag.tasks.length; i++) {
      const taskId = uuidv4();
      taskIds.push(taskId);

      const parentIndex = dag.tasks[i].parent_task_index;
      const parentTaskId =
        typeof parentIndex === "number" ? taskIds[parentIndex] : null;

      // Build payload - inject target_task_id for reviewers
      let payload = dag.tasks[i].payload || {};
      if (dag.tasks[i].agent_type === 'reviewer' && parentTaskId) {
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
        [taskId, jobId, dag.tasks[i].name, parentTaskId, i, dag.tasks[i].agent_type || 'executor', JSON.stringify(payload)]
      );
    }

    await client.query("COMMIT");

    // 🚀 Kick off execution
    await enqueueReadyTasks(jobId);

    res.status(201).json({
      jobId,
      taskCount: taskIds.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[WORKFLOW RUN ERROR]", err);
    res.status(500).json({ error: "Failed to run workflow" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/workflows
 * List workflow templates owned by user
 */
router.get("/", async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        wt.id,
        wt.name,
        wt.description,
        COUNT(wtv.id)::int AS version_count,
        wt.created_at
      FROM workflow_templates wt
      LEFT JOIN workflow_template_versions wtv
        ON wtv.template_id = wt.id
      WHERE
        (
          -- Legacy personal templates: only visible to owner
          (wt.organization_id IS NULL AND wt.owner_id = $1)
          OR
          -- Org templates: visible to org members
          wt.organization_id IN (
            SELECT organization_id
            FROM organization_members
            WHERE user_id = $1
          )
        )
      GROUP BY wt.id
      ORDER BY wt.created_at DESC
      `,
      [req.user!.id]
    );

    res.json(rows);
  } catch (err) {
    console.error("[WORKFLOW LIST ERROR]", err);
    res.status(500).json({ error: "Failed to list workflows" });
  }
});

/**
 * GET /api/workflows/:templateId
 * View template metadata + available versions
 */
router.get("/:templateId", async (req: AuthRequest, res) => {
  const { templateId } = req.params;

  try {
    // 🔐 Load template org and check role
    const { rows: templateRows } = await pool.query(
      `
      SELECT id, name, description, created_at, organization_id
      FROM workflow_templates
      WHERE id = $1
      `,
      [templateId]
    );

    if (!templateRows.length) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const template = templateRows[0];
    const templateOrgId = template.organization_id;
    
    if (templateOrgId) {
      await requireOrgRole(req.user!.id, templateOrgId, ["OWNER", "ADMIN", "MEMBER"]);
    }

    const { rows: versions } = await pool.query(
      `
      SELECT version, created_at
      FROM workflow_template_versions
      WHERE template_id = $1
      ORDER BY version DESC
      `,
      [templateId]
    );

    res.json({
      ...template,
      versions,
    });
  } catch (err) {
    console.error("[WORKFLOW DETAIL ERROR]", err);
    res.status(500).json({ error: "Failed to load workflow" });
  }
});

/**
 * GET /api/workflows/:templateId/versions/:version
 * Get DAG for a specific template version
 */
router.get("/:templateId/versions/:version", async (req: AuthRequest, res) => {
  const { templateId, version } = req.params;

  try {
    // 🔐 Load template org and check role
    const { rows: templateRows } = await pool.query(
      `
      SELECT id, organization_id
      FROM workflow_templates
      WHERE id = $1
      `,
      [templateId]
    );

    if (!templateRows.length) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const templateOrgId = templateRows[0].organization_id;
    if (templateOrgId) {
      await requireOrgRole(req.user!.id, templateOrgId, ["OWNER", "ADMIN", "MEMBER"]);
    }

    const { rows } = await pool.query(
      `
      SELECT dag, created_at
      FROM workflow_template_versions
      WHERE template_id = $1 AND version = $2
      `,
      [templateId, Number(version)]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Version not found" });
    }

    res.json({
      version: Number(version),
      dag: rows[0].dag,
      created_at: rows[0].created_at,
    });
  } catch (err) {
    console.error("[WORKFLOW VERSION ERROR]", err);
    res.status(500).json({ error: "Failed to load workflow version" });
  }
});

/**
 * POST /api/workflows/:templateId/versions
 * Create a new version of an existing workflow template
 */
router.post("/:templateId/versions", async (req: AuthRequest, res) => {
  const { templateId } = req.params;
  const { dag } = req.body;

  if (!dag || !Array.isArray(dag.tasks) || dag.tasks.length === 0) {
    return res.status(400).json({ error: "Invalid DAG definition" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔐 Load template org and enforce role
    const { rows } = await client.query(
      `
      SELECT organization_id
      FROM workflow_templates
      WHERE id = $1
      FOR UPDATE
      `,
      [templateId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Template not found" });
    }

    const templateOrgId = rows[0].organization_id;
    if (templateOrgId) {
      await requireOrgRole(req.user!.id, templateOrgId, ["OWNER", "ADMIN"]);
    }

    // Get latest version number
    const { rows: versionRows } = await client.query(
      `
      SELECT MAX(version) AS max_version
      FROM workflow_template_versions
      WHERE template_id = $1
      `,
      [templateId]
    );

    const nextVersion = (versionRows[0].max_version || 0) + 1;

    // Insert new version
    await client.query(
      `
      INSERT INTO workflow_template_versions (
        id, template_id, version, dag
      )
      VALUES (gen_random_uuid(), $1, $2, $3)
      `,
      [templateId, nextVersion, dag]
    );

    await client.query("COMMIT");

    res.status(201).json({
      templateId,
      version: nextVersion,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[WORKFLOW VERSION CREATE ERROR]", err);
    res.status(500).json({ error: "Failed to create workflow version" });
  } finally {
    client.release();
  }
});

export default router;
