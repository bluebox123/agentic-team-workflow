import { api } from "./client";

export interface Job {
  id: string;
  title: string;
  status: string;
  created_at: string;
  template_id?: string | null;
  template_version?: number | null;
  template_name?: string | null;
}

export interface Task {
  id: string;
  name: string;
  status: string;
  retry_count: number;
  started_at: string | null;
  finished_at: string | null;
  review_score: number | null;
  review_decision: string | null;
  agent_type: string;
  payload: Record<string, unknown> | null;
}

export async function fetchJobs(scope: 'mine' | 'org' = 'org'): Promise<Job[]> {
  const res = await api.get(`/jobs`, { params: { scope } });
  return res.data;
}

export async function fetchJob(jobId: string): Promise<Job> {
  const res = await api.get(`/jobs/${jobId}`);
  return res.data;
}

export interface TaskConfig {
  name: string;
  parent_task_index?: number;
  agent_type?: string;
  payload?: Record<string, unknown>;
}

export async function createJob(payload: { title: string; tasks: TaskConfig[] }): Promise<{ jobId: string; taskCount: number }> {
  const res = await api.post("/jobs", payload);
  return res.data;
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.post(`/jobs/${jobId}/cancel`);
}

export async function pauseJob(jobId: string): Promise<void> {
  await api.post(`/jobs/${jobId}/pause`);
}

export async function resumeJob(jobId: string): Promise<void> {
  await api.post(`/jobs/${jobId}/resume`);
}

export async function deleteJob(jobId: string): Promise<void> {
  await api.delete(`/jobs/${jobId}`);
}

export async function stopAndRemoveOldJobs(): Promise<{ stopped: number; removed: number }> {
  const res = await api.post(`/jobs/cleanup`);
  return res.data;
}

export interface ScheduleResponse {
  ok: boolean;
  jobId: string;
  type: string;
  nextRunAt: string;
}

export async function scheduleJob(jobId: string, schedule: { type: string; runAt?: string; cron?: string }): Promise<ScheduleResponse> {
  const res = await api.post(`/jobs/${jobId}/schedule`, schedule);
  return res.data;
}

export async function fetchJobTasks(jobId: string): Promise<Task[]> {
  const res = await api.get(`/jobs/${jobId}/tasks`);
  return res.data;
}
