import { Client } from "minio";

function parseEndpoint(raw: string | undefined): { endPoint: string; port: number } {
  const val = raw?.trim();
  if (!val) return { endPoint: "localhost", port: 9000 };

  // Accept "host" or "host:port". (No scheme expected.)
  const idx = val.lastIndexOf(":");
  if (idx > 0 && idx < val.length - 1) {
    const host = val.slice(0, idx);
    const portStr = val.slice(idx + 1);
    const port = Number(portStr);
    if (Number.isFinite(port) && port > 0) {
      return { endPoint: host, port };
    }
  }

  return { endPoint: val, port: 9000 };
}

const { endPoint, port } = parseEndpoint(process.env.MINIO_ENDPOINT);

const useSSL = process.env.MINIO_USE_SSL === "true";

const client = new Client({
  endPoint,
  port,
  useSSL,
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
});

const BUCKET = process.env.MINIO_BUCKET || "artifacts";
let storageAvailable = false;

export async function ensureBucket() {
  try {
    const exists = await client.bucketExists(BUCKET);
    if (!exists) {
      await client.makeBucket(BUCKET);
    }
    storageAvailable = true;
  } catch (err) {
    storageAvailable = false;
    throw err; // Re-throw to be caught in index.ts
  }
}

export function isStorageAvailable() {
  return storageAvailable;
}

export async function putObject(
  key: string,
  data: Buffer,
  contentType: string
) {
  if (!storageAvailable) {
    console.warn(`Storage not available, skipping putObject for ${key}`);
    return;
  }
  await client.putObject(BUCKET, key, data, data.length, {
    "Content-Type": contentType,
  });
}

export async function getObjectStream(key: string) {
  if (!storageAvailable) {
    throw new Error("Storage not available");
  }
  return client.getObject(BUCKET, key);
}
