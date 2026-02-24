import { api } from "./client";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  version_count: number;
  created_at: string;
}

export interface WorkflowVersion {
  version: number;
  created_at: string;
}

export interface WorkflowDetail extends WorkflowTemplate {
  versions: WorkflowVersion[];
  organization_id?: string | null;
}

export interface DagTask {
  name: string;
  parent_task_index?: number;
  agent_type?: string;
  payload?: Record<string, unknown>;
  params?: Record<string, unknown>; // backwards-compat for older UI
}

export interface DagDefinition {
  tasks: DagTask[];
  meta?: Record<string, unknown>;
}

export async function fetchWorkflows(): Promise<WorkflowTemplate[]> {
  const res = await api.get("/workflows");
  return res.data;
}

export async function fetchWorkflow(templateId: string): Promise<WorkflowDetail> {
  const res = await api.get(`/workflows/${templateId}`);
  return res.data;
}

export async function fetchWorkflowVersion(templateId: string, version: number): Promise<{ version: number; dag: DagDefinition; created_at: string }> {
  const res = await api.get(`/workflows/${templateId}/versions/${version}`);
  return res.data;
}

export async function createWorkflow(payload: { name: string; description?: string; dag: DagDefinition }): Promise<{ templateId: string; version: number }> {
  const res = await api.post("/workflows", payload);
  return res.data;
}

export async function createWorkflowVersion(templateId: string, payload: { dag: DagDefinition }): Promise<{ templateId: string; version: number }> {
  const res = await api.post(`/workflows/${templateId}/versions`, payload);
  return res.data;
}

export async function runWorkflow(templateId: string, payload: { version: number; title?: string; params?: Record<string, unknown> }): Promise<{ jobId: string; taskCount: number }> {
  const res = await api.post(`/workflows/${templateId}/run`, payload);
  return res.data;
}

export async function createWorkflowFromJob(payload: {
  jobId: string;
  name: string;
  description?: string;
  prompt?: string;
  visualDag?: unknown;
}): Promise<{ templateId: string; version: number }> {
  const res = await api.post("/workflows/from-job", payload);
  return res.data;
}
