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

  if (rows.length) {
    return rows[0].organization_id;
  }

  const isDev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
  if (!isDev) {
    throw new Error("User has no organization");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure the user exists (email can be null for local dev)
    await client.query(
      `
      INSERT INTO users (id)
      VALUES ($1)
      ON CONFLICT (id) DO NOTHING
      `,
      [userId]
    );

    // Create a personal org + membership (idempotent)
    const orgRes = await client.query(
      `
      INSERT INTO organizations (name)
      VALUES ('Personal')
      RETURNING id
      `
    );

    const orgId = orgRes.rows[0].id as string;

    await client.query(
      `
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES ($1, $2, 'OWNER')
      ON CONFLICT (organization_id, user_id) DO NOTHING
      `,
      [orgId, userId]
    );

    await client.query("COMMIT");
    return orgId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
