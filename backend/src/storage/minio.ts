import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
  const protocol = useSSL ? "https" : "http";
  const fullEndpoint = endpoint.startsWith("http") ? endpoint : `${protocol}://${endpoint}`;

  return new S3Client({
    endpoint: fullEndpoint,
    region: process.env.MINIO_REGION || "us-east-1", // Default region for S3-compatible services
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true, // Required for MinIO and Supabase Storage
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
    // Check if bucket exists
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    storageAvailable = true;
    console.log(`S3 bucket '${BUCKET}' is accessible`);
  } catch (err: any) {
    // Bucket doesn't exist or other error - try to create it
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
        storageAvailable = true;
        console.log(`S3 bucket '${BUCKET}' created successfully`);
      } catch (createErr: any) {
        storageAvailable = false;
        console.error("Failed to create S3 bucket:", createErr.message);
        throw createErr;
      }
    } else {
      storageAvailable = false;
      console.error("S3 bucket check failed:", err.message);
      throw err;
    }
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
