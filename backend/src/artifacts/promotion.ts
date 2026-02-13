import pool from "../db";
import { Artifact } from "./types";

export type ArtifactStatus = "draft" | "approved" | "frozen";

export interface PromotionRequest {
  target_status: ArtifactStatus;
}

export interface PromotionResult {
  success: boolean;
  artifact: Artifact;
  previous_status: ArtifactStatus;
  new_status: ArtifactStatus;
  promoted_at?: string;
  frozen_at?: string;
}

/**
 * Phase 8.6.2: Backend Promotion API
 * Handles artifact lifecycle promotion with strict validation
 */
export async function promoteArtifact(
  artifactId: string,
  request: PromotionRequest,
  userId: string
): Promise<PromotionResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current artifact
    const { rows } = await client.query(
      `
      SELECT id, job_id, type, role, status, frozen_at, promoted_from
      FROM artifacts
      WHERE id = $1
      FOR UPDATE
      `,
      [artifactId]
    );

    if (rows.length === 0) {
      throw new Error("Artifact not found");
    }

    const artifact = rows[0];
    const previousStatus = artifact.status as ArtifactStatus;

    // Validation rules
    if (artifact.status === 'frozen') {
      throw new Error("Frozen artifacts cannot be modified");
    }

    if (request.target_status === 'approved' && artifact.status !== 'draft') {
      throw new Error("Can only promote from draft to approved");
    }

    if (request.target_status === 'frozen') {
      if (artifact.status !== 'approved') {
        throw new Error("Can only promote from approved to frozen");
      }

      // Ensure no other frozen artifact exists for this (job, type, role)
      const { rows: existingFrozen } = await client.query(
        `
        SELECT id 
        FROM artifacts 
        WHERE job_id = $1 AND type = $2 AND role = $3 AND status = 'frozen'
        `,
        [artifact.job_id, artifact.type, artifact.role]
      );

      if (existingFrozen.length > 0) {
        throw new Error("A frozen artifact already exists for this job, type, and role");
      }
    }

    // Perform promotion
    let updateQuery = `
      UPDATE artifacts 
      SET status = $1, promoted_from = $2
    `;
    let updateParams: any[] = [request.target_status, artifact.id];

    if (request.target_status === 'frozen') {
      updateQuery += `, frozen_at = NOW()`;
    }

    updateQuery += ` WHERE id = $3 RETURNING *`;
    updateParams.push(artifactId);

    const { rows: updatedRows } = await client.query(updateQuery, updateParams);
    const updatedArtifact = updatedRows[0];

    // Log promotion action
    await client.query(
      `
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        userId,
        'artifact_promote',
        'artifact',
        artifactId,
        JSON.stringify({
          previous_status: previousStatus,
          new_status: request.target_status,
          promoted_at: new Date().toISOString()
        })
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      artifact: updatedArtifact,
      previous_status: previousStatus,
      new_status: request.target_status,
      promoted_at: new Date().toISOString(),
      frozen_at: request.target_status === 'frozen' ? new Date().toISOString() : undefined
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get artifact status history
 */
export async function getArtifactStatusHistory(artifactId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `
    SELECT 
      al.user_id,
      al.action,
      al.details,
      al.created_at,
      u.email as user_email
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.resource_type = 'artifact' 
      AND al.resource_id = $1
      AND al.action = 'artifact_promote'
    ORDER BY al.created_at DESC
    `,
    [artifactId]
  );

  return rows;
}

/**
 * Get frozen artifacts for a job
 */
export async function getFrozenArtifacts(jobId: string): Promise<Artifact[]> {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM artifacts
    WHERE job_id = $1 AND status = 'frozen'
    ORDER BY frozen_at DESC
    `,
    [jobId]
  );

  return rows;
}

/**
 * Check if user has permission to promote artifact
 */
export async function checkPromotionPermission(
  userId: string,
  artifactId: string,
  targetStatus: ArtifactStatus
): Promise<boolean> {
  // Get user and job information
  const { rows } = await pool.query(
    `
    SELECT u.id as user_id, j.user_id as job_owner_id
    FROM users u
    LEFT JOIN jobs j ON j.user_id = u.id
    LEFT JOIN artifacts a ON a.id = $1
    WHERE u.id = $2
    LIMIT 1
    `,
    [artifactId, userId]
  );

  if (rows.length === 0) {
    return false;
  }

  const { user_id, job_owner_id } = rows[0];

  // Owner can do anything
  if (job_owner_id === userId) {
    return true;
  }

  // For now, allow all authenticated users (simplified for testing)
  // In production, this would check organization roles
  return true;
}
