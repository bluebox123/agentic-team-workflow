import { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import https from "https";
import { request as httpsRequest } from "https";
import { URL } from "url";
import { createClient } from "@supabase/supabase-js";

// Custom HTTPS agent for Supabase S3 compatibility
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", // Allow disabling for Supabase S3 issues
  secureProtocol: "TLSv1_2_method",
  ciphers: "DEFAULT@SECLEVEL=1",
});

function isSupabaseS3Endpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  return endpoint.includes(".storage.supabase.co") || endpoint.includes("/storage/v1/s3");
}

function getSupabaseRestConfig(): { url: string; serviceRoleKey: string; bucket: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.MINIO_BUCKET || "artifacts";

  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey, bucket };
}

async function getObjectStreamViaSupabaseRest(storageKey: string): Promise<Readable> {
  const cfg = getSupabaseRestConfig();
  if (!cfg) {
    throw new Error("Supabase REST download not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
  }

  // Use service role key server-side only.
  const supabase = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.storage.from(cfg.bucket).download(storageKey);
  if (error) {
    throw new Error(`Supabase download failed: ${error.message}`);
  }
  // data is a Blob in node runtime; convert to stream.
  const stream: ReadableStream | undefined = (data as unknown as { stream?: () => ReadableStream })?.stream?.();
  if (!stream) {
    // Fallback: buffer the blob
    const buf = Buffer.from(await (data as any).arrayBuffer());
    return Readable.from(buf);
  }
  // Convert web stream to node stream
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Readable.fromWeb(stream as any);
}

function getSupabaseDownloadUrl(storageKey: string): string | null {
  const endpoint = process.env.MINIO_ENDPOINT?.trim();
  if (!endpoint) return null;

  // If MINIO_ENDPOINT is already a full URL, keep it. Otherwise build it.
  let base = endpoint;
  if (!base.startsWith("http")) {
    if (base.includes(".storage.supabase.co")) {
      base = `https://${base}/storage/v1/s3`;
    } else {
      const protocol = process.env.MINIO_USE_SSL !== "false" ? "https" : "http";
      base = `${protocol}://${base}`;
    }
  }

  // Supabase S3 endpoint expects path-style access for get object.
  // URL-encode each segment of the key but preserve slashes.
  const encodedKey = storageKey
    .split("/")
    .map(s => encodeURIComponent(s))
    .join("/");

  const bucket = process.env.MINIO_BUCKET || "artifacts";
  return `${base}/${bucket}/${encodedKey}`;
}

async function getObjectStreamViaHttps(storageKey: string): Promise<Readable> {
  const url = getSupabaseDownloadUrl(storageKey);
  if (!url) {
    throw new Error("S3 endpoint not configured for HTTPS fallback");
  }

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      new URL(url),
      {
        method: "GET",
        agent: httpsAgent,
        headers: {
          // Required for Supabase S3: it uses AWS Signature V4
          // so we still need AWS SDK normally. This fallback is mainly for cases
          // where Supabase is configured with public bucket/policies.
        },
      },
      res => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTPS fallback failed: ${res.statusCode} ${res.statusMessage || ""}`.trim()));
          res.resume();
          return;
        }
        resolve(res);
      }
    );

    req.on("error", reject);
    req.end();
  });
}

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

  console.log(`[S3] Creating client for endpoint: ${fullEndpoint}`);

  const shouldForcePathStyle =
    !isSupabaseS3Endpoint(endpoint) &&
    /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(endpoint || "");

  return new S3Client({
    endpoint: fullEndpoint,
    region: process.env.MINIO_REGION || "us-east-1", // Default region for S3-compatible services
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    // Local MinIO on localhost requires path-style, otherwise the SDK will try
    // to resolve bucketname.localhost (e.g. artifacts.localhost) and fail DNS.
    forcePathStyle: shouldForcePathStyle,
    requestHandler: new NodeHttpHandler({
      httpsAgent,
      requestTimeout: 30000,
      connectionTimeout: 5000,
    }),
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

  // If we are configured against Supabase's S3-compatible endpoint, prefer the official
  // Supabase Storage REST API for downloads. This avoids the recurring TLS handshake
  // failures (EPROTO) we see with Node + AWS SDK against Supabase S3.
  if (isSupabaseS3Endpoint(process.env.MINIO_ENDPOINT)) {
    return getObjectStreamViaSupabaseRest(key);
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
    const msg = String(err?.message || err);
    console.error(`Failed to get object ${key}:`, msg);

    // Supabase S3 endpoint sometimes fails TLS negotiation with the AWS SDK runtime.
    // Try HTTPS fallback for public buckets (or if policies allow unauthenticated reads).
    const shouldFallback = /EPROTO|handshake|ssl3_read_bytes|tls alert|SSL/i.test(msg);
    if (shouldFallback) {
      try {
        console.warn(`[S3] Retrying download via HTTPS fallback for key: ${key}`);
        return await getObjectStreamViaHttps(key);
      } catch (fallbackErr: any) {
        console.error(`[S3] HTTPS fallback also failed for key ${key}:`, String(fallbackErr?.message || fallbackErr));
      }
    }

    throw err;
  }
}
