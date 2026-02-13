export type ArtifactType =
  | "pdf"
  | "image"
  | "chart"
  | "table"
  | "json"
  | "text";

export interface Artifact {
  id: string;
  task_id: string;
  job_id: string;
  type: ArtifactType;
  filename: string;
  storage_key: string;
  mime_type?: string;
  previewable?: boolean;
  metadata?: Record<string, any>;
  role?: string;
  version?: number;
  is_current?: boolean;
  parent_artifact_id?: string;
  created_at?: string;
}
