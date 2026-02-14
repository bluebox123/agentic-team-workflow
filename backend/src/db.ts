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
  max: 10,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Log pool errors for visibility
pool.on('error', (err, client) => {
  console.error('[DB POOL ERROR] Unexpected error on idle client', err.message);
});

pool.on('connect', () => {
  // Normal operational noise - remove in production if too verbose
});

pool.on('acquire', () => {
  // Diagnostics: log when we start getting close to max
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  if (waiting > 0 || total >= pool.options.max - 1) {
    console.log(`[DB POOL] acquire - total:${total} idle:${idle} waiting:${waiting}`);
  }
});

// test a simple connection once and log result (do not throw)
(async () => {
  try {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT current_user, version() as pgversion;");
    console.log("[DB DEBUG] connected as:", rows[0].current_user, "pg:", rows[0].pgversion.split("\n")[0]);
    client.release();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[DB DEBUG] initial connection error:", msg);
  }
})();

export default pool;
