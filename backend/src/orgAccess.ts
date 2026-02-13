import pool from "./db";

export type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

/**
 * Resolve user's role in an organization
 */
export async function getUserOrgRole(
  userId: string,
  orgId: string
): Promise<OrgRole | null> {
  const { rows } = await pool.query(
    `
    SELECT role
    FROM organization_members
    WHERE user_id = $1 AND organization_id = $2
    `,
    [userId, orgId]
  );

  return rows.length ? rows[0].role : null;
}

/**
 * Require minimum role
 */
export async function requireOrgRole(
  userId: string,
  orgId: string,
  allowed: OrgRole[]
) {
  const role = await getUserOrgRole(userId, orgId);

  if (!role || !allowed.includes(role)) {
    const err: any = new Error("Not authorized");
    err.status = 403;
    throw err;
  }
}
