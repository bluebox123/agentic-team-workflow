// backend/src/db.ts
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

// load connection string from env (dotenv will load backend/.env)
const connectionString = process.env.DATABASE_URL || "postgres://devuser:devpass@localhost:5432/ai_workflow_dev";

// Print masked connection string so we can debug without revealing password entirely
function maskConn(s: string) {
  try {
    const parts = s.split("@");
    if (parts.length === 2) {
      const left = parts[0];
      const leftParts = left.split(":");
      if (leftParts.length >= 2) {
        const user = leftParts[0];
        return `${user}:***@${parts[1]}`;
      }
    }
  } catch (e) { }
  return s;
}

console.log("[DB DEBUG] Using DATABASE_URL =", maskConn(connectionString));

const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// test a simple connection once and log result (do not throw)
(async () => {
  try {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT current_user, version() as pgversion;");
    console.log("[DB DEBUG] connected as:", rows[0].current_user, "pg:", rows[0].pgversion.split("\n")[0]);
    client.release();
  } catch (err: any) {
    console.error("[DB DEBUG] initial connection error:", err && err.message ? err.message : err);
  }
})();

export default pool;
