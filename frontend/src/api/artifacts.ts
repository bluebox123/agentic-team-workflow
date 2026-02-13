import { api } from "./client";
import { API_BASE_URL } from "../config";

export interface Artifact {
  id: string;
  task_id: string;
  type: string;
  filename: string;
  storage_key: string;
  mime_type: string | null;
  previewable: boolean;
  role: string | null;
  status: string;
  frozen_at: string | null;
  promoted_from: string | null;
  created_at: string;
  version?: number;
  is_current?: boolean;
  parent_artifact_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function fetchArtifacts(jobId: string): Promise<Artifact[]> {
  const response = await api.get(`/jobs/${jobId}/artifacts`);
  return response.data;
}

export async function fetchArtifactVersions(jobId: string, type: string, role?: string): Promise<{
  job_id: string;
  type: string;
  role: string | null;
  versions: Artifact[];
  total_versions: number;
}> {
  const path = role 
    ? `/artifacts/versions/${jobId}/${type}/${role}`
    : `/artifacts/versions/${jobId}/${type}`;
  const res = await api.get(path);
  return res.data;
}

export async function fetchArtifactDiff(artifactId: string, fromVersion?: string, toVersion?: string): Promise<{
  from_version: string;
  to_version: string;
  type: string;
  role: string | null;
  differences: string[];
  metadata_changes: Record<string, { from: unknown; to: unknown }>;
}> {
  const params = new URLSearchParams();
  if (fromVersion) params.append("from", fromVersion);
  if (toVersion) params.append("to", toVersion);
  const res = await api.get(`/artifacts/${artifactId}/diff?${params.toString()}`);
  return res.data;
}

export async function promoteArtifact(artifactId: string, targetStatus: string): Promise<{
  success: boolean;
  message: string;
  promotion: {
    artifact_id: string;
    previous_status: string;
    new_status: string;
    promoted_at: string;
  };
}> {
  const res = await api.post(`/artifacts/${artifactId}/promote`, { target_status: targetStatus });
  return res.data;
}

export async function fetchArtifactStatusHistory(artifactId: string): Promise<{
  artifact_id: string;
  status_history: Array<{
    status: string;
    changed_at: string;
    changed_by: string | null;
  }>;
}> {
  const res = await api.get(`/artifacts/${artifactId}/status-history`);
  return res.data;
}

export async function fetchFrozenArtifacts(jobId: string): Promise<{
  job_id: string;
  frozen_artifacts: Artifact[];
  total: number;
}> {
  const res = await api.get(`/jobs/${jobId}/frozen-artifacts`);
  return res.data;
}

// Fetch artifact as plain text (used for text, JSON, etc.)
export async function fetchArtifactText(artifactId: string): Promise<string> {
  const res = await api.get(`/artifacts/${artifactId}/download`, {
    responseType: "text",
    transformResponse: (r) => r,
  });
  return res.data as unknown as string;
}

// Fetch artifact as a Blob (used for images, PDFs, binary files)
export async function fetchArtifactBlob(artifactId: string): Promise<Blob> {
  const res = await api.get(`/artifacts/${artifactId}/download`, {
    responseType: "blob",
  });
  return res.data as Blob;
}

export function getArtifactDownloadUrl(artifactId: string): string {
  return `${API_BASE_URL}/artifacts/${artifactId}/download`;
}
