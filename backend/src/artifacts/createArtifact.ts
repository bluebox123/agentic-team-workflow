import pool from "../db";
import { ArtifactType } from "./types";
import { ArtifactDefaults } from "./defaults";

interface CreateArtifactInput {
  task_id: string;
  job_id: string;
  type: ArtifactType;
  filename: string;
  storage_key: string;
  metadata?: Record<string, any>;
  role?: string; // Phase 8.4.2: Optional role for artifact
}

/**
 * Phase 8.5.2: Create versioned artifact with immutable history
 * Implements append-only artifact creation with proper versioning
 */
export async function createArtifact(input: CreateArtifactInput) {
  const defaults = ArtifactDefaults[input.type];

  if (!defaults) {
    throw new Error(`Unsupported artifact type: ${input.type}`);
  }

  const {
    task_id,
    job_id,
    type,
    filename,
    storage_key,
    metadata = {},
    role, // Phase 8.4.2: Extract role
  } = input;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Phase 8.5.2: Step A - Lock current artifact for update
    const currentResult = await client.query(
      `
      SELECT id, version
      FROM artifacts
      WHERE job_id = $1 AND type = $2 AND (role = $3 OR (role IS NULL AND $3 IS NULL))
        AND is_current = TRUE
      FOR UPDATE
      `,
      [job_id, type, role]
    );

    const currentArtifact = currentResult.rows[0];

    let parentArtifactId: string | null = null;
    let newVersion: number = 1;

    if (currentArtifact) {
      // Phase 8.5.2: Step B - Compute new version and parent
      parentArtifactId = currentArtifact.id;
      newVersion = currentArtifact.version + 1;

      // Phase 8.5.2: Step C - Mark old artifact as non-current
      await client.query(
        "UPDATE artifacts SET is_current = FALSE WHERE id = $1",
        [parentArtifactId]
      );
    }

    // Phase 8.6.3: Create new version with draft status
    const { rows } = await client.query(
      `
      INSERT INTO artifacts (
        task_id,
        job_id,
        type,
        filename,
        storage_key,
        mime_type,
        previewable,
        metadata,
        role,
        status,
        version,
        is_current,
        parent_artifact_id,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, NOW())
      RETURNING *
      `,
      [
        task_id,
        job_id,
        type,
        filename,
        storage_key,
        defaults.mime_type,
        defaults.previewable,
        metadata,
        role, // Phase 8.4.2: Include role in INSERT
        newVersion,
        true, // New version is current
        parentArtifactId, // Parent relationship
      ]
    );

    await client.query('COMMIT');

    console.log(`[ARTIFACT] Created version ${newVersion} for ${type}:${role || 'null'} (job: ${job_id})`);

    return rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
