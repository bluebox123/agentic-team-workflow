import { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";

// Parse endpoint for S3-compatible services (Supabase, MinIO, etc.)
function createS3Client(): S3Client | null {
  const endpoint = process.env.MINIO_ENDPOINT?.trim();
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  const useSSL = process.env.MINIO_USE_SSL !== "false"; // default true

  if (!endpoint || !accessKey || !secretKey) {
    console.warn("S3 storage not configured: Missing MINIO_ENDPOINT, MINIO_ACCESS_KEY, or MINIO_SECRET_KEY");
    return null;
  }

  // Build the full endpoint URL
  // Support both full URLs (with path) and hostname-only endpoints
  const protocol = useSSL ? "https" : "http";
  let fullEndpoint: string;
  if (endpoint.startsWith("http")) {
    // Full URL provided - use as-is (e.g., https://project.supabase.co/storage/v1/s3)
    fullEndpoint = endpoint;
  } else if (endpoint.includes(".storage.supabase.co")) {
    // Supabase storage subdomain - convert to S3 API path
    fullEndpoint = `https://${endpoint}/storage/v1/s3`;
  } else {
    // Hostname only - add protocol
    fullEndpoint = `${protocol}://${endpoint}`;
  }

  return new S3Client({
    endpoint: fullEndpoint,
    region: process.env.MINIO_REGION || "us-east-1", // Default region for S3-compatible services
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: false, // Supabase uses virtual-hosted-style
  });
}

const client = createS3Client();
const BUCKET = process.env.MINIO_BUCKET || "artifacts";
let storageAvailable = false;

export async function ensureBucket() {
  if (!client) {
    storageAvailable = false;
    throw new Error("S3 client not initialized - check environment variables");
  }

  try {
    // Log the endpoint for debugging
    console.log(`[STORAGE DEBUG] Attempting S3 connection to endpoint: ${process.env.MINIO_ENDPOINT}`);
    console.log(`[STORAGE DEBUG] Bucket: ${BUCKET}`);
    
    // For Supabase, just verify we can connect by listing buckets
    // The bucket must already exist in Supabase Storage UI
    const response = await client.send(new ListBucketsCommand({}));
    const bucketExists = response.Buckets?.some(b => b.Name === BUCKET);
    
    if (bucketExists) {
      storageAvailable = true;
      console.log(`S3 bucket '${BUCKET}' is accessible`);
    } else {
      // Try a simple put operation to verify access
      // Supabase doesn't support CreateBucket via S3 API
      storageAvailable = true;
      console.warn(`S3 bucket '${BUCKET}' may not exist. Ensure bucket is created in Supabase Storage UI.`);
      console.log(`Proceeding with storage operations - uploads will fail if bucket doesn't exist.`);
    }
  } catch (err: any) {
    storageAvailable = false;
    console.error("S3 connection failed:", err.message);
    
    // Log the raw response for debugging
    if (err.$response) {
      console.error("[STORAGE DEBUG] Raw response status:", err.$response.statusCode);
      console.error("[STORAGE DEBUG] Raw response headers:", err.$response.headers);
      try {
        const body = await err.$response.body.transformToString();
        console.error("[STORAGE DEBUG] Raw response body:", body.substring(0, 500));
      } catch (e) {
        console.error("[STORAGE DEBUG] Could not read response body");
      }
    }
    
    throw err;
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
  if (!client || !storageAvailable) {
    console.warn(`Storage not available, skipping putObject for ${key}`);
    return;
  }

  try {
    const upload = new Upload({
      client,
      params: {
        Bucket: BUCKET,
        Key: key,
        Body: data,
        ContentType: contentType,
      },
    });

    await upload.done();
    console.log(`Successfully uploaded ${key} to S3`);
  } catch (err: any) {
    console.error(`Failed to upload ${key}:`, err.message);
    throw err;
  }
}

export async function getObjectStream(key: string): Promise<Readable> {
  if (!client || !storageAvailable) {
    throw new Error("Storage not available");
  }

  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));

    if (!response.Body) {
      throw new Error("Empty response body from S3");
    }

    return response.Body as Readable;
  } catch (err: any) {
    console.error(`Failed to get object ${key}:`, err.message);
    throw err;
  }
}
