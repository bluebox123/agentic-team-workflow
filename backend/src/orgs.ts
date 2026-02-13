import pool from "./db";

/**
 * Get the user's default (personal) organization ID
 */
export async function getDefaultOrgId(userId: string): Promise<string> {
  const { rows } = await pool.query(
    `
    SELECT organization_id
    FROM organization_members
    WHERE user_id = $1
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [userId]
  );

  if (!rows.length) {
    throw new Error("User has no organization");
  }

  return rows[0].organization_id;
}

/**
 * Get all organizations for a user with their roles
 */
export async function getUserOrgs(userId: string) {
  const { rows } = await pool.query(
    `
    SELECT o.id, o.name, om.role
    FROM organizations o
    JOIN organization_members om ON om.organization_id = o.id
    WHERE om.user_id = $1
    ORDER BY o.created_at ASC
    `,
    [userId]
  );

  return rows;
}
