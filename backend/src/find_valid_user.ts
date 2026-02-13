import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Hardcode from known .env
const DATABASE_URL = 'postgres://devuser:devpass@127.0.0.1:5433/ai_workflow_dev';

const pool = new Pool({
    connectionString: DATABASE_URL
});

async function findValidUser() {
    console.log("Connecting to DB:", DATABASE_URL);
    const client = await pool.connect();
    try {
        console.log("Querying users...");
        const users = await client.query("SELECT id, email FROM users LIMIT 1");
        if (users.rows.length === 0) {
            console.log("No users found. You might need to seed the DB.");
            return;
        }
        const user = users.rows[0];
        console.log("Found User:", user);

        console.log("Querying organizations...");
        const orgs = await client.query("SELECT id, name FROM organizations LIMIT 1");
        if (orgs.rows.length === 0) {
            console.log("No organizations found.");
        } else {
            console.log("Found Org:", orgs.rows[0]);
        }

        // Check organization members
        const members = await client.query("SELECT * FROM organization_members WHERE user_id = $1", [user.id]);
        console.log("User Org Memberships:", members.rows);

    } catch (err: any) {
        console.error("Error:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

findValidUser();
